import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { installWallet } from "./pro.browser-support";
import { address } from "./pro-fixtures";

async function mockProStatus(page: Page, status: Record<string, unknown>) {
  await page.route("**/api/pro/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    });
  });
}

test("policy builder on the gated Pro page validates, copies, downloads and applies", async ({
  page,
  context,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Holder session verified.",
    address: address(9),
    balance: "1000000",
    required: "1000000",
    decimals: 6,
    mint: address(7),
    slot: 1,
    toolsPath: "/pro.html",
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./pro.html");
  await expect(page.getByTestId("policy-builder")).toBeVisible();
  await page.goto("./");
  const original = JSON.parse(
    await page
      .getByLabel("Signed voucher payload", { exact: true })
      .inputValue(),
  );
  await page.goto("./pro.html");
  const builder = page.getByTestId("policy-builder");
  await builder
    .getByLabel("Maximum cumulative amount", { exact: true })
    .fill("499");
  await builder
    .getByLabel("Expected channel identifier", { exact: true })
    .fill(original.policy.expectedChannelId.value);
  await builder
    .getByLabel("Minimum remaining validity / seconds", { exact: true })
    .fill("301");
  await builder
    .getByLabel("Maximum remaining validity / seconds", { exact: true })
    .fill("300");
  await expect(builder.getByRole("alert")).toContainText("inverted");
  await expect(
    builder.getByRole("button", { name: "Apply to Advanced" }),
  ).toBeDisabled();
  await builder
    .getByLabel("Minimum remaining validity / seconds", { exact: true })
    .fill("");
  await builder
    .getByLabel("Maximum remaining validity / seconds", { exact: true })
    .fill("");
  await builder.getByRole("button", { name: "Copy JSON", exact: true }).click();
  await expect(builder.getByRole("status")).toContainText("copied");
  expect(
    JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
      .maxCumulativeAmount,
  ).toBe("499");
  const downloadPromise = page.waitForEvent("download");
  await builder
    .getByRole("button", { name: "Download policy", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("voucherguard-policy.json");
  const path = await download.path();
  if (!path) throw Error("Missing download");
  expect(JSON.parse(await readFile(path, "utf8")).maxCumulativeAmount).toBe(
    "499",
  );
  await builder
    .getByRole("button", { name: "Apply to Advanced", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/(?:voucherguard\/)?(?:index\.html)?(?:#.*)?$/,
  );
  await expect(
    page.getByLabel("Signed voucher payload", { exact: true }),
  ).toBeVisible();
  const applied = JSON.parse(
    await page
      .getByLabel("Signed voucher payload", { exact: true })
      .inputValue(),
  );
  expect(applied.policy.maxCumulativeAmount).toBe("499");
  const { policy: _p, ...actual } = applied;
  const { policy: _o, ...expected } = original;
  expect(actual).toEqual(expected);
  await page
    .getByRole("button", { name: "Verify locally", exact: true })
    .click();
  await expect(page.getByTestId("status")).toHaveText("FAIL");
  await expect(page.locator(".checks")).toContainText("AMOUNT_LIMIT");
});

test("homepage Pro stays locked without a Worker holder session", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "locked",
    message: "Prove $VG holdings with a wallet signature to unlock Pro.",
  });
  await installWallet(page);
  await page.goto("./");
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Prove holdings to unlock",
  );
  await expect(page.getByTestId("policy-builder")).toHaveCount(0);
  await page
    .locator("#pro")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prove holdings" }),
  ).toBeVisible();
});

test("ineligible Worker status cannot open Policy Builder", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "ineligible",
    message: "Holder threshold not met",
    balance: "0",
    required: "1000000",
    decimals: 6,
  });
  await page.goto("./pro.html");
  await expect(page).toHaveURL(/#pro/);
  await expect(page.getByTestId("policy-builder")).toHaveCount(0);
});

test("eligible homepage offers the protected Policy Builder link", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Holder session verified.",
    address: address(9),
    toolsPath: "/pro.html",
  });
  await installWallet(page);
  await page.goto("./");
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  await expect(
    page.locator("#pro").getByRole("link", { name: "Open Policy Builder" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
