import { readFileSync } from "node:fs";
import {
  parsePolicyDocument,
  parseVoucherDocument,
  verifyVoucher,
} from "@voucherguard/core";
import { describe, expect, it, vi } from "vitest";
import {
  formatTokenUnits,
  MAINNET_GENESIS,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  thresholdUnits,
  validateConfig,
} from "../apps/web/src/pro/config";
import {
  aggregateTokenAccounts,
  checkEligibility,
  MAX_RPC_RESPONSE_BYTES,
  MAX_TOKEN_ACCOUNTS,
  SolanaOwnershipReader,
} from "../apps/web/src/pro/eligibility";
import {
  applyPolicyToDocument,
  buildPolicy,
  CONSERVATIVE_POLICY,
  STANDARD_POLICY,
} from "../apps/web/src/pro/policy";
import {
  account,
  address,
  mintResponse,
  rpcFetcher,
  TEST_CONFIG,
  TEST_MINT,
  tokenEntry,
  tokens,
} from "./pro-fixtures";

const signal = () => new AbortController().signal;
const reader = (opts: Parameters<typeof rpcFetcher>[0] = {}) =>
  new SolanaOwnershipReader(rpcFetcher(opts).fetcher);

describe("Pro configuration and exact holder threshold", () => {
  it("unset mint never checks balances even for a connected wallet", async () => {
    const read = vi.fn();
    const r = await checkEligibility(
      { ...TEST_CONFIG, mint: "" },
      account(),
      { read },
      signal(),
    );
    expect(r.status).toBe("not-configured");
    expect(read).not.toHaveBeenCalled();
  });
  it("configured mint with no connected wallet is disconnected", async () => {
    const read = vi.fn();
    expect(
      (await checkEligibility(TEST_CONFIG, null, { read }, signal())).status,
    ).toBe("disconnected");
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["invalid", "0OIl", address(7).slice(1)])(
    "invalid mint %s fails closed",
    async (mint) => {
      expect(
        (
          await checkEligibility(
            { ...TEST_CONFIG, mint },
            account(),
            reader(),
            signal(),
          )
        ).status,
      ).toBe("rpc-error");
    },
  );
  it.each(["devnet", "testnet", "solana:mainnet"])(
    "unsupported configured network %s",
    async (network) => {
      expect(
        (
          await checkEligibility(
            { ...TEST_CONFIG, network },
            account(),
            reader(),
            signal(),
          )
        ).status,
      ).toBe("unsupported-network");
    },
  );
  it("wallet account without mainnet support is unsupported", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(9, ["solana:devnet"]),
          reader(),
          signal(),
        )
      ).status,
    ).toBe("unsupported-network");
  });
  it("wallet address must match its provided public key", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          { ...account(), address: address(8) },
          reader(),
          signal(),
        )
      ).status,
    ).toBe("unsupported-network");
  });
  it.each([
    "http://rpc.example.test",
    "https://user:secret@rpc.example.test",
    "not-a-url",
  ])("invalid RPC %s fails closed", (url) => {
    expect(validateConfig({ ...TEST_CONFIG, rpcUrl: url }).status).toBe(
      "rpc-error",
    );
  });
  it.each(["0", "-1", "1e3", "01", "1.2.3", "NaN"])(
    "invalid threshold %s fails closed",
    (threshold) => {
      expect(validateConfig({ ...TEST_CONFIG, threshold }).status).toBe(
        "rpc-error",
      );
    },
  );
  it("exact raw-unit conversion does not use floats", () => {
    expect(thresholdUnits("1", 6)).toBe(1000000n);
    expect(thresholdUnits("0.125", 6)).toBe(125000n);
    expect(thresholdUnits("9007199254740993", 0)).toBe(9007199254740993n);
    expect(thresholdUnits("1.000", 2)).toBe(100n);
  });
  it("unsupported threshold precision cannot unlock", async () => {
    expect(
      (
        await checkEligibility(
          { ...TEST_CONFIG, threshold: "0.0000001" },
          account(),
          reader(),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("balance formatting preserves exact digits", () => {
    expect(formatTokenUnits(9007199254740993n, 6)).toBe("9007199254.740993");
    expect(formatTokenUnits(1000000n, 6)).toBe("1");
    expect(formatTokenUnits(1n, 6)).toBe("0.000001");
  });
});
describe("mainnet SPL token ownership inspection", () => {
  it("zero holdings is ineligible", async () => {
    const r = await checkEligibility(
      TEST_CONFIG,
      account(),
      reader({ accounts: tokens([]) }),
      signal(),
    );
    expect(r.status).toBe("ineligible");
    expect(r.balance).toBe(0n);
  });
  it.each([
    ["999999", "ineligible"],
    ["1000000", "eligible"],
    ["1000001", "eligible"],
  ])("threshold boundary %s -> %s", async (amount, status) => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ accounts: tokens([tokenEntry(amount)]) }),
          signal(),
        )
      ).status,
    ).toBe(status);
  });
  it("aggregates multiple distinct accounts at the threshold", async () => {
    const r = await checkEligibility(
      TEST_CONFIG,
      account(),
      reader({
        accounts: tokens([tokenEntry("400000", 20), tokenEntry("600000", 21)]),
      }),
      signal(),
    );
    expect(r.status).toBe("eligible");
    expect(r.balance).toBe(1000000n);
  });
  it("supports a Token-2022 mint and its owned accounts", async () => {
    const r = await checkEligibility(
      TEST_CONFIG,
      account(),
      reader({
        mint: mintResponse(TOKEN_2022_PROGRAM),
        accounts: tokens([
          tokenEntry("1000000", 20, address(9), TEST_MINT, TOKEN_2022_PROGRAM),
        ]),
      }),
      signal(),
    );
    expect(r.status).toBe("eligible");
  });
  it("does not use uiAmount or uiAmountString for eligibility", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ accounts: tokens([tokenEntry("0")]) }),
          signal(),
        )
      ).status,
    ).toBe("ineligible");
  });
  it.each(["mint", "owner", "program"])(
    "wrong token account %s fails closed",
    async (field) => {
      const a = tokenEntry();
      if (field === "mint") a.account.data.parsed.info.mint = address(8);
      if (field === "owner") a.account.data.parsed.info.owner = address(8);
      if (field === "program") a.account.owner = TOKEN_2022_PROGRAM;
      expect(
        (
          await checkEligibility(
            TEST_CONFIG,
            account(),
            reader({ accounts: tokens([a]) }),
            signal(),
          )
        ).status,
      ).toBe("rpc-error");
    },
  );
  it("duplicate account entries cannot count twice", async () => {
    const a = tokenEntry("500000");
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ accounts: tokens([a, a]) }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("token decimals must match on-chain mint decimals", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({
            accounts: tokens([
              tokenEntry(
                "1000000",
                20,
                address(9),
                TEST_MINT,
                TOKEN_PROGRAM,
                9,
              ),
            ]),
          }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it.each(["-1", "1e6", "1.2", "18446744073709551616"])(
    "malformed raw amount %s fails closed",
    async (amount) => {
      expect(
        (
          await checkEligibility(
            TEST_CONFIG,
            account(),
            reader({ accounts: tokens([tokenEntry(amount)]) }),
            signal(),
          )
        ).status,
      ).toBe("rpc-error");
    },
  );
  it("mint account must exist", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ mint: { context: { slot: 1000 }, value: null } }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("mint program must be a supported Token program", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ mint: mintResponse(address(0)) }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("mint initialized flag and integer decimals are required", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ mint: mintResponse(TOKEN_PROGRAM, 6.5) }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("rejects token snapshots older than the mint snapshot", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ accounts: tokens([tokenEntry()], 999) }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("validates full genesis hash, not the truncated CAIP-2 reference", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ genesis: MAINNET_GENESIS.slice(0, 32) }),
          signal(),
        )
      ).status,
    ).toBe("unsupported-network");
  });
  it("rejects a devnet RPC even if account and mint look valid", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({ genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWZ6z5zHJYZ" }),
          signal(),
        )
      ).status,
    ).toBe("unsupported-network");
  });
  it("HTTP errors close access; a new read can recover", async () => {
    const fake = rpcFetcher();
    let failed = true;
    const fetcher: typeof fetch = async (...args) =>
      failed
        ? new Response("rate limited", { status: 429 })
        : fake.fetcher(...args);
    const r = new SolanaOwnershipReader(fetcher);
    expect(
      (await checkEligibility(TEST_CONFIG, account(), r, signal())).status,
    ).toBe("rpc-error");
    failed = false;
    expect(
      (await checkEligibility(TEST_CONFIG, account(), r, signal())).status,
    ).toBe("eligible");
    expect(fake.methods).toEqual([
      "getGenesisHash",
      "getAccountInfo",
      "getTokenAccountsByOwner",
    ]);
  });
  it("malformed JSON-RPC cannot grant access", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("{}", { status: 200 });
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          new SolanaOwnershipReader(fetcher),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("oversized streamed RPC responses without a length header are canceled and stay locked", async () => {
    const cancel = vi.fn();
    const fetcher: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_RPC_RESPONSE_BYTES));
            controller.enqueue(new Uint8Array(1));
          },
          cancel,
        }),
      );
    const result = await checkEligibility(
      TEST_CONFIG,
      account(),
      new SolanaOwnershipReader(fetcher),
      signal(),
    );
    expect(result.status).toBe("rpc-error");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("oversized declared RPC responses are rejected before consumption", async () => {
    const cancel = vi.fn();
    const fetcher: typeof fetch = async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Length": String(MAX_RPC_RESPONSE_BYTES + 1) },
      });
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          new SolanaOwnershipReader(fetcher),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("an RPC token-account list beyond the limit cannot unlock", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          reader({
            accounts: tokens(Array(MAX_TOKEN_ACCOUNTS + 1).fill(tokenEntry())),
          }),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("network rejection remains closed", async () => {
    const fetcher: typeof fetch = async () => {
      throw Error("offline");
    };
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          new SolanaOwnershipReader(fetcher),
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("aborted reads cannot grant access even if an injected reader resolves", async () => {
    const c = new AbortController();
    c.abort();
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          {
            read: async () => ({ balance: 1000000n, decimals: 6, slot: 1000 }),
          },
          c.signal,
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("rejects malformed adapter balances without coercion", async () => {
    expect(
      (
        await checkEligibility(
          TEST_CONFIG,
          account(),
          {
            read: async () => ({
              balance: 1 as unknown as bigint,
              decimals: 6,
              slot: 1000,
            }),
          },
          signal(),
        )
      ).status,
    ).toBe("rpc-error");
  });
  it("frozen accounts count ownership, not spendability", () => {
    const a = tokenEntry();
    a.account.data.parsed.info.state = "frozen";
    expect(
      aggregateTokenAccounts(
        tokens([a]),
        address(9),
        TEST_MINT,
        TOKEN_PROGRAM,
        6,
        1000,
      ).balance,
    ).toBe(1000000n);
  });
});
describe("standalone policy builder shared schema", () => {
  it("default policy matches the core schema", () => {
    expect(parsePolicyDocument(buildPolicy(STANDARD_POLICY))).toEqual({
      rejectNonExpiring: true,
      requireState: true,
    });
  });
  it("both presets are real configurable policies", () => {
    expect(
      parsePolicyDocument(buildPolicy(CONSERVATIVE_POLICY)).maxIncrease,
    ).toBe(100000n);
  });
  it("all control values serialize as decimal strings", () => {
    const p = buildPolicy({
      ...STANDARD_POLICY,
      maxCumulativeAmount: "9007199254740993",
      maxIncrease: "0",
      minRemainingSeconds: "0",
      maxRemainingSeconds: "300",
      expectedChannelId: "07".repeat(32),
    });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    expect(parsePolicyDocument(p).maxCumulativeAmount).toBe(9007199254740993n);
  });
  it.each(["1.5", "-1", "1e5", "01", "18446744073709551616"])(
    "invalid amount %s",
    (maxCumulativeAmount) => {
      expect(() =>
        buildPolicy({ ...STANDARD_POLICY, maxCumulativeAmount }),
      ).toThrow();
    },
  );
  it("rejects inverted time windows with core validation", () => {
    expect(() =>
      buildPolicy({
        ...STANDARD_POLICY,
        minRemainingSeconds: "301",
        maxRemainingSeconds: "300",
      }),
    ).toThrow("inverted");
  });
  it("channel identifier supports explicit encodings", () => {
    expect(
      parsePolicyDocument(
        buildPolicy({
          ...STANDARD_POLICY,
          expectedChannelId: address(7),
          channelEncoding: "base58",
        }),
      ).expectedChannelId,
    ).toEqual(new Uint8Array(32).fill(7));
  });
  it("rejects malformed channel identifier", () => {
    expect(() =>
      buildPolicy({ ...STANDARD_POLICY, expectedChannelId: "bad" }),
    ).toThrow();
  });
  it("preserves every unrelated voucher field when applying", () => {
    const payload = readFileSync("examples/valid.json", "utf8");
    const original = JSON.parse(payload);
    const p = buildPolicy({
      ...STANDARD_POLICY,
      expectedChannelId: "07".repeat(32),
      maxCumulativeAmount: "499",
    });
    const applied = JSON.parse(applyPolicyToDocument(payload, p));
    const { policy: _p, ...rest } = applied;
    const { policy: _o, ...expected } = original;
    expect(rest).toEqual(expected);
    expect(applied.policy).toEqual(p);
  });
  it("applied policy drives the existing real verification engine", async () => {
    const payload = readFileSync("examples/valid.json", "utf8");
    const p = buildPolicy({
      ...STANDARD_POLICY,
      expectedChannelId: "07".repeat(32),
      maxCumulativeAmount: "499",
    });
    expect(
      (
        await verifyVoucher(
          parseVoucherDocument(JSON.parse(applyPolicyToDocument(payload, p))),
        )
      ).status,
    ).toBe("FAIL");
  });
  it.each(["{", "[]", "null"])(
    "invalid playground JSON %s is not modified",
    (payload) => {
      expect(() =>
        applyPolicyToDocument(payload, buildPolicy(STANDARD_POLICY)),
      ).toThrow();
    },
  );
  it("unknown standalone policy fields are rejected", () => {
    expect(() => parsePolicyDocument({ maxCumAmount: "1" })).toThrow();
  });
});
