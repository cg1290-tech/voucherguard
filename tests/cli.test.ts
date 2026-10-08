import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["packages/cli/dist/index.js", ...args], {
    encoding: "utf8",
  });
}
it.each([
  ["valid", 0, "PASS"],
  ["signature", 1, "FAIL"],
  ["expired", 1, "FAIL"],
  ["amount", 1, "FAIL"],
  ["channel", 1, "FAIL"],
  ["stale", 1, "FAIL"],
  ["state", 2, "INDETERMINATE"],
])("CLI %s matches core and expected exit", (id, exit, status) => {
  const result = cli("verify", `examples/${id}.json`, "--json");
  expect(result.status).toBe(exit);
  expect(JSON.parse(result.stdout).status).toBe(status);
});
it("CLI decodes without claiming verification", () => {
  const r = cli("decode", "examples/valid.json");
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).verification).toBe("NOT_PERFORMED");
});
it("CLI inspect prints detailed human-readable evidence", () => {
  const r = cli("inspect", "examples/signature.json");
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SIGNATURE_INVALID");
  expect(r.stdout).toContain("Limitations:");
});
it("CLI rejects malformed JSON with machine readable error", () => {
  const dir = mkdtempSync(join(tmpdir(), "voucherguard-"));
  try {
    const f = join(dir, "bad.json");
    writeFileSync(f, "{");
    const r = cli("verify", f, "--json");
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).code).toBe("INPUT_ERROR");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
it("CLI overrides the application amount policy", () => {
  const r = cli("verify", "examples/valid.json", "--max", "499", "--json");
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("AMOUNT_LIMIT");
});
it("CLI independent signer override rejects forged context", () => {
  const r = cli(
    "verify",
    "examples/valid.json",
    "--signer",
    `hex:${"00".repeat(32)}`,
    "--json",
  );
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("SIGNATURE_INVALID");
});
it("CLI rejects unknown flags and missing files", () => {
  expect(cli("verify", "examples/valid.json", "--wallet").status).toBe(3);
  expect(cli("verify", "does-not-exist.json").status).toBe(3);
});
it("CLI help exits successfully", () => {
  expect(
    execFileSync(process.execPath, ["packages/cli/dist/index.js", "--help"], {
      encoding: "utf8",
    }),
  ).toContain("no transactions");
});
