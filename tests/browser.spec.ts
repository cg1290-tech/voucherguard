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
    if (!r.url().startsWith("http://127.0.0.1:4173/"))
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
  await page.getByLabel("Maximum cumulative amount").fill("499");
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
