import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, transformWithEsbuild } from "vite";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "read-only-pages-relay",
      async generateBundle() {
        const source = readFileSync(
          new URL("./src/rpc-worker.ts", import.meta.url),
          "utf8",
        );
        const result = await transformWithEsbuild(source, "rpc-worker.ts", {
          loader: "ts",
          target: "es2022",
        });
        this.emitFile({
          type: "asset",
          fileName: "_worker.js",
          source: result.code,
        });
        this.emitFile({
          type: "asset",
          fileName: "_routes.json",
          source: JSON.stringify({
            version: 1,
            include: ["/api/solana-rpc"],
            exclude: [],
          }),
        });
      },
    },
  ],
  base: process.env.VITE_BASE_PATH || "./",
});
