import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const scenarios = JSON.parse(
  readFileSync("apps/web/src/fixtures.json", "utf8"),
) as { name: string; expected: string; document: unknown }[];

import {
  parseVoucherDocument,
  serializeReport,
  verifyVoucher,
} from "../packages/core/src/index.js";

test("production site under a Pages subpath: scenarios, equivalent reports, offline execution, export and reset", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const externalRequests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4183/"))
      externalRequests.push(r.url());
  });
  await page.goto("./");
  await expect(
    page.getByRole("heading", {
      name: "AI agents can spend money. Verify what they sign.",
    }),
  ).toBeVisible();
  await context.setOffline(true);
  for (const scenario of scenarios) {
    await page.getByRole("button", { name: new RegExp(scenario.name) }).click();
    await page.getByRole("button", { name: "Verify locally" }).click();
    await expect(page.getByTestId("status")).toHaveText(scenario.expected);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("Report was not downloaded");
    const browserReport = await readFile(path, "utf8");
    const coreReport = serializeReport(
      await verifyVoucher(parseVoucherDocument(scenario.document)),
    );
    expect(JSON.parse(browserReport)).toEqual(JSON.parse(coreReport));
  }
  await page.getByRole("button", { name: /Valid payment voucher/ }).click();
  await page.getByRole("button", { name: "Verify locally" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "docs/preview-desktop.png", fullPage: true });
  const textDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export text" }).click();
  expect((await textDownload).suggestedFilename()).toBe(
    "voucherguard-report.txt",
  );
  await page
    .locator("#playground")
    .getByLabel("Maximum cumulative amount")
    .fill("499");
  await expect(page.getByTestId("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Verify locally" }).click();
  await expect(page.getByTestId("status")).toHaveText("FAIL");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Signed voucher payload")).toHaveValue("");
  await expect(page.getByTestId("status")).toHaveCount(0);
  await page.getByLabel("Signed voucher payload").fill("{");
  await page.getByRole("button", { name: "Verify locally" }).click();
  await expect(page.getByRole("alert")).toContainText("Input rejected");
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
test("mobile layout, keyboard access and missing signer never passes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: /Insufficient state/ }).click();
  await page.getByRole("button", { name: "Verify locally" }).click();
  await expect(page.getByTestId("status")).toHaveText("INDETERMINATE");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/preview-mobile.png", fullPage: true });
  await page.getByLabel("Expected authorized signer / hex").fill("");
  await page.getByRole("button", { name: "Verify locally" }).click();
  await expect(page.getByTestId("status")).toHaveText("INDETERMINATE");
  await page.getByRole("button", { name: "Verify locally" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("status")).toHaveText("INDETERMINATE");
});

test("default production Pro stays locked with an unset mint and has no test bypass", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  const { installWallet } = await import("./pro.browser-support");
  await installWallet(page);
  await page.goto("./");
  await page
    .locator("#pro")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Token access coming soon",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
  await page.getByRole("button", { name: /Valid payment voucher/ }).click();
  await page.getByRole("button", { name: "Verify locally" }).click();
  await expect(page.getByTestId("status")).toHaveText("PASS");
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = readdirSync("apps/web/dist/assets").filter((f) =>
    f.endsWith(".js"),
  );
  const bundle = files
    .map((f) => readFileSync(`apps/web/dist/assets/${f}`, "utf8"))
    .join("");
  expect(bundle).not.toContain("VoucherGuard Browser Test Wallet");
  expect(bundle).not.toContain("vg-test-control");
  expect(bundle).not.toContain("voucherguard-rpc.example.test");
  expect(posts).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.locator("#pro").screenshot({ path: "docs/pro-coming-soon.png" });
});
