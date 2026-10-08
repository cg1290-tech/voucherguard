import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  decodeBytes,
  decodeVoucher,
  encodeBytes,
  encodeVoucher,
  parseVoucherDocument,
  serializeReport,
  U64_MAX,
  type VerifyInput,
  verifyVoucher,
} from "@voucherguard/core";
import { describe, expect, it } from "vitest";

const seed = new Uint8Array(32).fill(42);
const signer = ed25519.getPublicKey(seed);
const channel = new Uint8Array(32).fill(7);
function input(amount = 500n, expiresAt = 2000n): VerifyInput {
  const message = encodeVoucher({
    channelId: channel,
    cumulativeAmount: amount,
    expiresAt,
  });
  return {
    message,
    signature: ed25519.sign(message, seed),
    authorizedSigner: signer,
    now: 1000n,
    policy: { expectedChannelId: channel },
    trustedState: {
      channelId: channel,
      authorizedSigner: signer,
      deposit: U64_MAX,
      settledAmount: 100n,
      status: "Open",
    },
  };
}
async function code(i: VerifyInput, expected: string) {
  const r = await verifyVoucher(i);
  expect(r.checks.some((c) => c.code === expected)).toBe(true);
  return r;
}
describe("canonical wire format", () => {
  it("ports the upstream Rust voucher_args_bytes_match_signed_payload_layout vector", () => {
    const message = encodeVoucher({
      channelId: channel,
      cumulativeAmount: 0x0011223344556677n,
      expiresAt: 0x7ffefdfcfbfaf9f8n,
    });
    expect(encodeBytes(message, "hex")).toBe(
      `5601${"07".repeat(32)}7766554433221100f8f9fafbfcfdfe7f`,
    );
  });
  it.each([0, 1, 49, 51, 100])("rejects message length %s", (n) => {
    expect(() => decodeVoucher(new Uint8Array(n))).toThrow("exactly 50");
  });
  it("rejects magic and unsupported versions separately", () => {
    const m = input().message;
    m[0] = 0;
    expect(() => decodeVoucher(m)).toThrow("domain");
    m[0] = 0x56;
    m[1] = 2;
    expect(() => decodeVoucher(m)).toThrow("version");
  });
  it.each([0n, 2n ** 53n, 2n ** 53n + 1n, U64_MAX])(
    "round trips u64 %s without precision loss",
    (amount) => {
      expect(
        decodeVoucher(
          encodeVoucher({
            channelId: channel,
            cumulativeAmount: amount,
            expiresAt: 0n,
          }),
        ).cumulativeAmount,
      ).toBe(amount);
    },
  );
  it.each([-(2n ** 63n), -1n, 0n, 2n ** 63n - 1n])(
    "round trips signed i64 %s",
    (expiresAt) => {
      expect(
        decodeVoucher(
          encodeVoucher({
            channelId: channel,
            cumulativeAmount: 0n,
            expiresAt,
          }),
        ).expiresAt,
      ).toBe(expiresAt);
    },
  );
  it.each([-1n, 1n << 64n, 123 as unknown as bigint])(
    "rejects amount overflow or number %s",
    (cumulativeAmount) => {
      expect(() =>
        encodeVoucher({ channelId: channel, cumulativeAmount, expiresAt: 0n }),
      ).toThrow();
    },
  );
  it.each([-(2n ** 63n) - 1n, 2n ** 63n, 1 as unknown as bigint])(
    "rejects i64 overflow or number %s",
    (expiresAt) => {
      expect(() =>
        encodeVoucher({ channelId: channel, cumulativeAmount: 0n, expiresAt }),
      ).toThrow();
    },
  );
  it("handles offset buffers and copies channel bytes", () => {
    const storage = new Uint8Array(60);
    storage.set(input().message, 5);
    const v = decodeVoucher(storage.subarray(5, 55));
    storage[7] = 3;
    expect(v.channelId[0]).toBe(7);
  });
});
describe("real cryptographic checks", () => {
  it("passes a genuine signature and independently cross-checks with Node crypto", async () => {
    const i = input();
    expect((await verifyVoucher(i)).status).toBe("PASS");
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(signer),
    ]);
    expect(
      nodeVerify(
        null,
        i.message,
        createPublicKey({ key: spki, format: "der", type: "spki" }),
        i.signature,
      ),
    ).toBe(true);
  });
  it("fails a modified message", async () => {
    const i = input();
    i.message[34] = 1;
    expect((await code(i, "SIGNATURE_INVALID")).status).toBe("FAIL");
  });
  it("fails signature corruption", async () => {
    const i = input();
    i.signature[10] = (i.signature[10] ?? 0) ^ 1;
    expect((await code(i, "SIGNATURE_INVALID")).status).toBe("FAIL");
  });
  it("fails wrong trusted signer", async () => {
    const i = input();
    i.authorizedSigner = ed25519.getPublicKey(new Uint8Array(32).fill(10));
    expect((await code(i, "SIGNATURE_INVALID")).status).toBe("FAIL");
  });
  it.each([0, 31, 33, 64])("rejects malformed public key length %s", (n) => {
    const i = input();
    i.authorizedSigner = new Uint8Array(n);
    return verifyVoucher(i).then((r) => expect(r.status).toBe("FAIL"));
  });
  it.each([0, 63, 65])("rejects malformed signature length %s", (n) => {
    const i = input();
    i.signature = new Uint8Array(n);
    return verifyVoucher(i).then((r) => expect(r.status).toBe("FAIL"));
  });
  it("rejects identity-key forgery", async () => {
    const i = input();
    const identity = new Uint8Array(32);
    identity[0] = 1;
    const sig = new Uint8Array(64);
    sig[0] = 1;
    i.authorizedSigner = identity;
    i.signature = sig;
    expect((await code(i, "SIGNATURE_INVALID")).status).toBe("FAIL");
  });
  it("requires an independent signer", async () => {
    const i = input();
    delete i.authorizedSigner;
    expect((await code(i, "SIGNER_REQUIRED")).status).toBe("INDETERMINATE");
  });
});
describe("expiration and application policies", () => {
  it.each([
    [999n, "PASS"],
    [1000n, "FAIL"],
    [1001n, "FAIL"],
  ])("uses strict expiration boundary at %s", async (now, status) => {
    const i = input(500n, 1000n);
    i.now = now;
    expect((await verifyVoucher(i)).status).toBe(status);
  });
  it("rejects negative expiry at nonnegative time", async () => {
    expect((await code(input(500n, -1n), "EXPIRED")).status).toBe("FAIL");
  });
  it("permits non-expiring protocol vouchers unless policy rejects them", async () => {
    const i = input(500n, 0n);
    expect((await code(i, "NON_EXPIRING")).status).toBe("PASS");
    i.policy = { ...i.policy, rejectNonExpiring: true };
    expect((await code(i, "EXPIRY_REQUIRED")).status).toBe("FAIL");
  });
  it("requires finite expiry when a time-window policy is specified", async () => {
    const i = input(500n, 0n);
    i.policy = { ...i.policy, maxRemainingSeconds: 500n };
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
  it.each([
    [999n, "FAIL"],
    [1000n, "PASS"],
    [1001n, "FAIL"],
  ])("enforces inclusive time window %s", async (remaining, status) => {
    const i = input(500n, 1000n + remaining);
    i.policy = {
      ...i.policy,
      minRemainingSeconds: 1000n,
      maxRemainingSeconds: 1000n,
    };
    expect((await verifyVoucher(i)).status).toBe(status);
  });
  it("fails an inverted policy window", async () => {
    const i = input();
    i.policy = {
      ...i.policy,
      minRemainingSeconds: 10n,
      maxRemainingSeconds: 1n,
    };
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
  it("requires expected channel even with valid signature", async () => {
    const i = input();
    i.policy = {};
    expect((await code(i, "CHANNEL_REQUIRED")).status).toBe("INDETERMINATE");
  });
  it("rejects wrong channel", async () => {
    const i = input();
    i.policy = { expectedChannelId: new Uint8Array(32) };
    expect((await code(i, "CHANNEL_MISMATCH")).status).toBe("FAIL");
  });
  it.each([
    [499n, "FAIL"],
    [500n, "PASS"],
    [501n, "PASS"],
  ])("enforces amount cap %s", async (cap, status) => {
    const i = input();
    i.policy = { ...i.policy, maxCumulativeAmount: cap };
    expect((await verifyVoucher(i)).status).toBe(status);
  });
  it("rejects unsafe JS numbers passed through runtime", async () => {
    const i = input();
    i.policy = {
      ...i.policy,
      maxCumulativeAmount: 9007199254740992 as unknown as bigint,
    };
    expect((await code(i, "INVALID_INPUT")).status).toBe("FAIL");
  });
  it("rejects misspelled policy fields", async () => {
    const i = input();
    i.policy = { ...i.policy, maxAmont: 1n } as NonNullable<
      VerifyInput["policy"]
    >;
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
});
describe("trusted state and conditional outcomes", () => {
  it("returns unknown on missing state by default", async () => {
    const i = input();
    delete i.trustedState;
    expect((await code(i, "STATE_REQUIRED")).status).toBe("INDETERMINATE");
  });
  it("explicit stateless scope has visible limitations", async () => {
    const i = input();
    delete i.trustedState;
    i.policy = { ...i.policy, requireState: false };
    const r = await verifyVoucher(i);
    expect(r.status).toBe("PASS");
    expect(r.limitations.some((s) => s.includes("explicitly excluded"))).toBe(
      true,
    );
  });
  it("increase policy still needs state when stateless scope selected", async () => {
    const i = input();
    delete i.trustedState;
    i.policy = { ...i.policy, requireState: false, maxIncrease: 400n };
    expect((await verifyVoucher(i)).status).toBe("INDETERMINATE");
  });
  it.each([499n, 500n, 501n])(
    "rejects cumulative at/below settled %s",
    async (settled) => {
      const i = input();
      if (i.trustedState) i.trustedState.settledAmount = settled;
      expect((await verifyVoucher(i)).status).toBe(
        settled < 500n ? "PASS" : "FAIL",
      );
    },
  );
  it("rejects previously accepted equal cumulative", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.previouslyAcceptedAmount = 500n;
    expect((await code(i, "STALE_AUTHORIZATION")).status).toBe("FAIL");
  });
  it.each([
    [399n, "FAIL"],
    [400n, "PASS"],
    [401n, "PASS"],
  ])("bounds increase %s", async (limit, status) => {
    const i = input();
    i.policy = { ...i.policy, maxIncrease: limit };
    expect((await verifyVoucher(i)).status).toBe(status);
  });
  it("uses higher accepted vs settled watermark for increase", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.previouslyAcceptedAmount = 490n;
    i.policy = { ...i.policy, maxIncrease: 10n };
    expect((await verifyVoucher(i)).status).toBe("PASS");
  });
  it("rejects over deposit", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.deposit = 499n;
    expect((await code(i, "OVER_DEPOSIT")).status).toBe("FAIL");
  });
  it("rejects incoherent state", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.deposit = 50n;
    expect((await code(i, "INVALID_INPUT")).status).toBe("FAIL");
  });
  it.each(["Closing", "Sealed", "Distributed"] as const)(
    "rejects lifecycle %s for ordinary settle",
    async (status) => {
      const i = input();
      if (i.trustedState) i.trustedState.status = status;
      expect((await code(i, "STATE_NOT_OPEN")).status).toBe("FAIL");
    },
  );
  it("rejects state for another channel", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.channelId = new Uint8Array(32);
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
  it("rejects state for another signer", async () => {
    const i = input();
    if (i.trustedState) i.trustedState.authorizedSigner = new Uint8Array(32);
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
  it("failure takes precedence over missing state", async () => {
    const i = input();
    delete i.trustedState;
    i.signature.fill(0);
    expect((await verifyVoucher(i)).status).toBe("FAIL");
  });
  it("is deterministic with explicit time/state and serializes integers", async () => {
    const i = input();
    expect(serializeReport(await verifyVoucher(i))).toBe(
      serializeReport(await verifyVoucher(i)),
    );
    expect(
      JSON.parse(serializeReport(await verifyVoucher(i))).decoded
        .cumulativeAmount,
    ).toBe("500");
  });
});
describe("JSON and byte adapters", () => {
  const validDoc = () =>
    JSON.parse(readFileSync("examples/valid.json", "utf8"));
  it.each(["hex", "base64", "base58"] as const)(
    "roundtrips strict %s",
    (encoding) => {
      const m = input().message;
      expect(decodeBytes(encodeBytes(m, encoding), encoding, 50)).toEqual(m);
    },
  );
  it.each(["zz", "0", "0x12", " 12", "12\n"])(
    "rejects corrupted hex %s",
    (str) => {
      expect(() => decodeBytes(str, "hex", 50)).toThrow();
    },
  );
  it.each(["%%%", "AA", "AAAA=", " AAAAAA=="])(
    "rejects corrupted base64 %s",
    (str) => {
      expect(() => decodeBytes(str, "base64", 50)).toThrow();
    },
  );
  it("rejects invalid base58 characters", () => {
    expect(() => decodeBytes("0OIl", "base58", 32)).toThrow();
  });
  it.each(["1.2", "01", "-1", "1e9", 100, "184467440737095516160"])(
    "rejects malformed integer %s",
    (v) => {
      const doc = validDoc();
      doc.policy.maxCumulativeAmount = v;
      expect(() => parseVoucherDocument(doc)).toThrow();
    },
  );
  it("rejects unsupported protocol/envelopes and unknown fields", () => {
    const doc = validDoc();
    doc.protocol = "x402";
    expect(() => parseVoucherDocument(doc)).toThrow();
    const other = validDoc();
    other.secret = "x";
    expect(() => parseVoucherDocument(other)).toThrow();
  });
  it("rejects malformed JSON", () => {
    expect(() => JSON.parse("{")).toThrow();
  });
  it("rejects false boolean encoded as string", () => {
    const doc = validDoc();
    doc.policy.requireState = "false";
    expect(() => parseVoucherDocument(doc)).toThrow();
  });
  it("all seven shared browser documents match expected outcomes", async () => {
    const fixtures = JSON.parse(
      readFileSync("apps/web/src/fixtures.json", "utf8"),
    ) as { expected: string; document: unknown }[];
    for (const f of fixtures)
      expect(
        (await verifyVoucher(parseVoucherDocument(f.document))).status,
      ).toBe(f.expected);
  });
});

it("rejects unknown SDK state fields before recording assumptions", async () => {
  const i = input();
  i.trustedState = {
    ...i.trustedState,
    privateKey: "do-not-record",
  } as NonNullable<VerifyInput["trustedState"]>;
  const r = await verifyVoucher(i);
  expect(r.status).toBe("FAIL");
  expect(serializeReport(r)).not.toContain("do-not-record");
});
it("rejects null context rather than treating it as omitted", async () => {
  const i = input();
  i.policy = null as unknown as NonNullable<VerifyInput["policy"]>;
  expect((await verifyVoucher(i)).status).toBe("FAIL");
});
it("zero cumulative is not above a settled zero watermark", async () => {
  const i = input(0n);
  if (i.trustedState) i.trustedState.settledAmount = 0n;
  expect((await verifyVoucher(i)).status).toBe("FAIL");
});
