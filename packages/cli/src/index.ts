#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import {
  decodeBytes,
  decodeVoucher,
  formatReport,
  parseVoucherDocument,
  serializeReport,
  verifyVoucher,
} from "@voucherguard/core";

const help = `VoucherGuard — offline verification (no transactions)
Usage: voucherguard <verify|decode|inspect> voucher.json [options]
  --json              JSON output
  --signer hex:<key>   Independently expected public key (hex/base58/base64)
  --channel hex:<id>   Independently expected channel ID
  --max <decimal>     Application cumulative amount cap
  --now <seconds>     Explicit Unix time (defaults to current clock)
  --state <file>      Independently trusted channel snapshot JSON
  --policy <file>     Application policy JSON
Exit: 0 PASS/decode success, 1 FAIL, 2 INDETERMINATE, 3 input/usage error.
File-provided keys/state are assertions, not authenticated evidence.`;
async function readJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 65536)
    throw new Error("Input file exceeds 64 KiB");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
function field(value: string): { encoding: string; value: string } {
  const i = value.indexOf(":");
  const encoding = value.slice(0, i);
  const data = value.slice(i + 1);
  if (i < 0 || !["hex", "base58", "base64"].includes(encoding))
    throw new Error("Use hex:, base58: or base64: prefix");
  decodeBytes(data, encoding as "hex" | "base58" | "base64", 32);
  return { encoding, value: data };
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  try {
    if (args.length === 0 || args[0] === "--help") {
      console.log(help);
      return;
    }
    const command = args[0];
    const path = args[1];
    if (
      !["verify", "decode", "inspect"].includes(command ?? "") ||
      !path ||
      path.startsWith("--")
    )
      throw new Error(help);
    const options: Record<string, string> = {};
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json") continue;
      if (
        !arg ||
        ![
          "--signer",
          "--channel",
          "--max",
          "--now",
          "--state",
          "--policy",
        ].includes(arg) ||
        options[arg] !== undefined
      )
        throw new Error(`Invalid or duplicate option: ${arg}`);
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      options[arg] = value;
    }
    const raw = await readJson(path);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Document must be an object");
    const doc = raw as Record<string, unknown>;
    if (options["--signer"]) doc.authorizedSigner = field(options["--signer"]);
    if (options["--now"]) doc.now = options["--now"];
    if (options["--state"])
      doc.trustedState = await readJson(options["--state"]);
    if (options["--policy"]) doc.policy = await readJson(options["--policy"]);
    if (options["--channel"] || options["--max"]) {
      if (
        doc.policy !== undefined &&
        (!doc.policy ||
          typeof doc.policy !== "object" ||
          Array.isArray(doc.policy))
      )
        throw new Error("Policy must be an object");
      doc.policy = {
        ...(doc.policy as Record<string, unknown> | undefined),
        ...(options["--channel"]
          ? { expectedChannelId: field(options["--channel"]) }
          : {}),
        ...(options["--max"] ? { maxCumulativeAmount: options["--max"] } : {}),
      };
    }
    const input = parseVoucherDocument(doc);
    if (command === "decode") {
      console.log(
        serializeReport({
          verification: "NOT_PERFORMED",
          voucher: decodeVoucher(input.message),
        }),
      );
      return;
    }
    const report = await verifyVoucher(input);
    console.log(json ? serializeReport(report) : formatReport(report));
    process.exitCode =
      report.status === "PASS" ? 0 : report.status === "FAIL" ? 1 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input";
    if (json)
      console.log(
        serializeReport({
          status: "FAIL",
          code: "INPUT_ERROR",
          explanation: message,
        }),
      );
    else console.error(message);
    process.exitCode = 3;
  }
}
await main();
