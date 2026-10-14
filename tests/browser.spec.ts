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
  await page.route("**/api/pro/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "not-configured",
        message:
          "Token access coming soon. Holder mint is not configured on the server.",
      }),
    });
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
  await expect(page.getByTestId("policy-builder")).toHaveCount(0);
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

test("Free X-Ray loads once, plays recorded money and permissions, and keeps failed attempts explicit", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  const { base58 } = await import("@scure/base");
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setUint32(0, 2, true);
  new DataView(bytes.buffer).setBigUint64(4, 1000000000n, true);
  fixture.result.transaction.message.accountKeys.push(
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  const approval = new Uint8Array(9);
  approval[0] = 4;
  new DataView(approval.buffer).setBigUint64(1, 1000000n, true);
  fixture.result.transaction.message.instructions = [
    { programIdIndex: 5, accounts: [0, 1], data: base58.encode(bytes) },
    { programIdIndex: 6, accounts: [1, 0, 0], data: base58.encode(approval) },
  ];
  fixture.result.meta.innerInstructions = [];
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await page.goto("./");
  await page
    .getByTestId("quick-input")
    .fill(`https://solscan.io/tx/${fixture.result.transaction.signatures[0]}`);
  await page
    .locator("#quick-check")
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  const xray = page.getByTestId("transaction-xray");
  await expect(xray).toBeVisible();
  await expect(xray.getByTestId("wallet-impact")).toContainText(
    "What actually changed?",
  );
  await expect(
    xray
      .getByTestId("wallet-impact")
      .getByRole("button", { name: "Export Wallet Impact" }),
  ).toHaveCount(0);
  await expect(xray).toContainText("SOL transfer instruction");
  await xray
    .getByRole("button", { name: "Inspect current instruction" })
    .click();
  await expect(xray).toContainText("No intermediate balances are simulated");
  await xray.getByRole("button", { name: "Next step" }).click();
  await xray.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(xray).toContainText("Spending delegation");
  await expect(xray).toContainText("Permission endpoint");
  await xray.getByRole("button", { name: "Play X-Ray" }).click();
  await expect(xray.getByRole("button", { name: "Pause X-Ray" })).toBeVisible();
  await xray.getByRole("button", { name: "Pause X-Ray" }).click();
  await xray
    .getByLabel("My wallet / account")
    .selectOption(fixture.result.transaction.message.accountKeys[1]);
  await expect(xray.getByRole("status")).toContainText("2 of 2 recorded steps");
  await expect(xray).toContainText("To selected account");
  await expect(xray.locator(".xray-focus-node")).toHaveCount(1);
  await xray.getByRole("button", { name: "Next step" }).click();
  await expect(xray).toContainText("From selected account");
  await xray.getByLabel("My wallet / account").selectOption("");
  expect(calls).toBe(1);
  await expect(page.getByTestId("quick-unsupported")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(xray).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await xray.screenshot({ path: "../VoucherGuard-XRay-free-mobile.png" });
  fixture.result.meta.err = { InstructionError: [1, "InsufficientFunds"] };
  fixture.result.meta.logMessages = [
    "Program log: <script>untrusted diagnostic</script>",
  ];
  await page
    .locator("#quick-check")
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(xray).toContainText("Attempted only");
  await expect(xray.getByTestId("failure-explanation")).toContainText(
    "An account did not have enough funds",
  );
  await xray.getByRole("button", { name: "Show failure point" }).click();
  await expect(xray.locator(".xray-stage")).toHaveClass(/xray-failed-step/);
  await expect(xray).toContainText("FAILURE REPORTED HERE");
  await xray
    .getByText("Recorded logs & error evidence", { exact: true })
    .click();
  await expect(xray.locator(".xray-logs")).toContainText(
    "<script>untrusted diagnostic</script>",
  );
  await expect(xray.locator(".xray-logs script")).toHaveCount(0);
  await expect(xray.getByTestId("failure-explanation")).toContainText(
    "Recorded network fee:",
  );
  await expect(xray.locator(".xray-stage")).not.toHaveClass(/xray-running/);
  expect(calls).toBe(2);
});
