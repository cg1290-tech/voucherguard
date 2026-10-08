import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { browserName: "chromium" },
  projects: [
    {
      name: "static",
      testMatch: "**/browser.spec.ts",
      use: { baseURL: "http://127.0.0.1:4183/voucherguard/" },
    },
    {
      name: "pro",
      testMatch: "**/pro.browser.spec.ts",
      use: { baseURL: "http://127.0.0.1:4184/voucherguard/" },
    },
  ],
  webServer: [
    {
      command:
        "VITE_BASE_PATH=/voucherguard/ pnpm --filter @voucherguard/web preview --port 4183 --strictPort",
      url: "http://127.0.0.1:4183/voucherguard/",
      reuseExistingServer: false,
    },
    {
      command: "node scripts/pro-browser-server.mjs",
      url: "http://127.0.0.1:4184/voucherguard/",
      reuseExistingServer: false,
    },
  ],
});
