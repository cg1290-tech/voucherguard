// Test-only production build. Wallet/RPC mocks live in Playwright; none enters the bundle.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { base58 } from "@scure/base";

const directory = mkdtempSync(join(tmpdir(), "voucherguard-pro-browser-"));
const vite = resolve("apps/web/node_modules/vite/bin/vite.js");
const env = {
  ...process.env,
  VITE_BASE_PATH: "/voucherguard/",
  VITE_VG_TOKEN_MINT: base58.encode(new Uint8Array(32).fill(7)),
  VITE_VG_RPC_URL: "https://voucherguard-rpc.example.test",
  VITE_VG_HOLDER_THRESHOLD: "1",
  VITE_VG_NETWORK: "mainnet-beta",
};
const build = spawnSync(
  process.execPath,
  [vite, "build", "--outDir", directory, "--emptyOutDir"],
  { cwd: resolve("apps/web"), env, stdio: "inherit" },
);
if (build.status !== 0) {
  rmSync(directory, { recursive: true, force: true });
  process.exit(build.status ?? 1);
}
const server = spawn(
  process.execPath,
  [
    vite,
    "preview",
    "--outDir",
    directory,
    "--host",
    "127.0.0.1",
    "--port",
    "4184",
    "--strictPort",
  ],
  { cwd: resolve("apps/web"), env, stdio: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
