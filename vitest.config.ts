import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "@voucherguard/core": resolve("packages/core/src/index.ts") },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
