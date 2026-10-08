import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173/voucherguard/",
    browserName: "chromium",
  },
  webServer: {
    command:
      "VITE_BASE_PATH=/voucherguard/ pnpm --filter @voucherguard/web preview --port 4173",
    url: "http://127.0.0.1:4173/voucherguard/",
    reuseExistingServer: false,
  },
});
