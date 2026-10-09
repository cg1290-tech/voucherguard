import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import * as esbuild from "esbuild";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      name: "pages-worker",
      async generateBundle() {
        const result = await esbuild.build({
          absWorkingDir: root,
          entryPoints: ["src/worker/index.ts"],
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2022",
          logLevel: "silent",
        });
        const code = result.outputFiles[0]?.text;
        if (!code) throw new Error("Worker bundle was empty");
        this.emitFile({
          type: "asset",
          fileName: "_worker.js",
          source: code,
        });
        this.emitFile({
          type: "asset",
          fileName: "_routes.json",
          source: JSON.stringify({
            version: 1,
            include: ["/api/*", "/pro.html", "/pro/*"],
            exclude: [],
          }),
        });
      },
    },
  ],
  base: process.env.VITE_BASE_PATH || "./",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        pro: path.resolve(root, "pro.html"),
      },
      output: {
        // Only the Pro entry is Worker-gated under /pro/*; shared chunks stay public.
        entryFileNames: (chunk) =>
          chunk.name === "pro" ? "pro/app.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
