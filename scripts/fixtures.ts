import { writeFile } from "node:fs/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  encodeBytes,
  encodeVoucher,
  PROTOCOL,
} from "../packages/core/src/index.js";

// PUBLIC, TEST ONLY seed. Never fund this key or use it outside simulations.
const seed = new Uint8Array(32).fill(42);
const signer = ed25519.getPublicKey(seed);
const channel = new Uint8Array(32).fill(7);
const enc = (b: Uint8Array) => ({
  encoding: "hex",
  value: encodeBytes(b, "hex"),
});
function fixture(amount = 500n, expiry = 2000000000n) {
  const message = encodeVoucher({
    channelId: channel,
    cumulativeAmount: amount,
    expiresAt: expiry,
  });
  return {
    protocol: PROTOCOL,
    message: enc(message),
    signature: enc(ed25519.sign(message, seed)),
    authorizedSigner: enc(signer),
    now: "1900000000",
    policy: {
      expectedChannelId: enc(channel),
      maxCumulativeAmount: "1000",
      rejectNonExpiring: true,
    },
    trustedState: {
      channelId: enc(channel),
      authorizedSigner: enc(signer),
      deposit: "2000",
      settledAmount: "100",
      status: "Open",
    },
  };
}
const valid = fixture();
const changed = fixture();
changed.message.value = `${changed.message.value.slice(0, 68)}f5${changed.message.value.slice(70)}`;
const wrongChannel = fixture();
wrongChannel.policy.expectedChannelId = enc(new Uint8Array(32).fill(9));
const stale = fixture();
stale.trustedState.settledAmount = "500";
const { trustedState: _state, ...unknown } = fixture();
const fixtures = [
  {
    id: "valid",
    name: "Valid payment voucher",
    expected: "PASS",
    detail:
      "A genuine test signature, matching channel, deposit and advancing watermark.",
    document: valid,
  },
  {
    id: "signature",
    name: "Invalid signature",
    expected: "FAIL",
    detail:
      "The amount byte was modified after signing. Cryptographic verification fails.",
    document: changed,
  },
  {
    id: "expired",
    name: "Expired voucher",
    expected: "FAIL",
    detail: "A genuine signature cannot make an expired authorization fresh.",
    document: fixture(500n, 1800000000n),
  },
  {
    id: "amount",
    name: "Unauthorized amount",
    expected: "FAIL",
    detail:
      "A correctly signed amount of 1500 exceeds the application limit of 1000.",
    document: fixture(1500n),
  },
  {
    id: "channel",
    name: "Wrong channel",
    expected: "FAIL",
    detail:
      "The independently expected channel differs from the signed channel.",
    document: wrongChannel,
  },
  {
    id: "stale",
    name: "Stale authorization",
    expected: "FAIL",
    detail:
      "Cumulative amount equals the supplied settled watermark; strict advancement fails.",
    document: stale,
  },
  {
    id: "state",
    name: "Insufficient state",
    expected: "INDETERMINATE",
    detail:
      "Signature is valid, but required deposit, lifecycle and freshness state is absent.",
    document: unknown,
  },
];
for (const f of fixtures)
  await writeFile(
    `examples/${f.id}.json`,
    `${JSON.stringify(f.document, null, 2)}\n`,
  );
await writeFile(
  "apps/web/src/fixtures.json",
  `${JSON.stringify(fixtures, null, 2)}\n`,
);
