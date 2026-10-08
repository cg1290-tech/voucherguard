import { readFile } from "node:fs/promises";
import {
  decodeBytes,
  parseVoucherDocument,
  serializeReport,
  verifyVoucher,
} from "../packages/core/dist/index.js";

const doc = JSON.parse(
  await readFile(new URL("./valid.json", import.meta.url), "utf8"),
);
const input = parseVoucherDocument(doc);
// Independent constants here are PUBLIC SIMULATION context, not actual chain state.
const signer = decodeBytes(
  "197f6b23e16c8532c6abc838facd5ea789be0c76b2920334039bfa8b3d368d61",
  "hex",
  32,
);
const channel = new Uint8Array(32).fill(7);
input.authorizedSigner = signer;
input.policy = {
  expectedChannelId: channel,
  maxCumulativeAmount: 1000n,
  rejectNonExpiring: true,
};
input.trustedState = {
  channelId: channel,
  authorizedSigner: signer,
  deposit: 2000n,
  settledAmount: 100n,
  status: "Open",
};
input.now = 1900000000n;
const report = await verifyVoucher(input);
console.log(serializeReport(report));
if (report.status !== "PASS") process.exitCode = 1;
