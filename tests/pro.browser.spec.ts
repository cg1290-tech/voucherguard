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
  await page
    .getByText("Optional: custom rules & saved policies", { exact: true })
    .click();
  await expect(page.getByTestId("policy-builder")).toBeVisible();
  await page.goto("./");
  const original = JSON.parse(
    await page
      .getByLabel("Signed voucher payload", { exact: true })
      .inputValue(),
  );
  await page.goto("./pro.html");
  await page
    .getByText("Optional: custom rules & saved policies", { exact: true })
    .click();
  const builder = page.getByTestId("policy-builder");
  await builder
    .getByText("Advanced constraints & JSON", { exact: true })
    .click();
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
    page.locator("#pro").getByRole("link", { name: "Open Pro workspace" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Robinhood prelaunch gate shows its network and leaves connection disabled without a project ID", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (/walletconnect/i.test(request.url())) external.push(request.url());
  });
  await mockProStatus(page, {
    status: "not-configured",
    network: "robinhood",
    chainId: 4663,
    message: "Official contract not configured.",
  });
  await page.goto("./");
  await expect(page.locator("#pro .pro-network")).toHaveText("ROBINHOOD CHAIN");
  await expect(
    page.getByRole("button", { name: "Connect Robinhood Wallet", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("policy-builder")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("a server-issued Robinhood holder session offers the protected tools route", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    network: "robinhood",
    chainId: 4663,
    message: "Holder session verified.",
    address: `0x${"11".repeat(20)}`,
    balance: "1000000000000000000",
    required: "1000000000000000000",
    decimals: 18,
    contract: `0x${"22".repeat(20)}`,
    blockNumber: "123",
    toolsPath: "/pro.html",
  });
  await page.goto("./");
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  await expect(
    page
      .locator("#pro")
      .getByRole("link", { name: "Open Pro workspace", exact: true }),
  ).toHaveAttribute("href", "/pro.html");
  await expect(page.locator("#pro")).toContainText("Observed at block 123");
});

test("holder workspace saves revisions, restores policies and verifies imported batches", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
    toolsPath: "/pro.html",
  });
  await page.goto("./pro.html");
  await page
    .getByText("Optional: custom rules & saved policies", { exact: true })
    .click();
  await page
    .getByLabel("Policy name", { exact: true })
    .fill("Agent production");
  await page
    .getByLabel("Spending limit in tokens", { exact: true })
    .fill("1.5");
  await page
    .getByRole("button", { name: "Set spending limit", exact: true })
    .click();
  await expect(
    page.getByLabel("Maximum cumulative amount", { exact: true }),
  ).toHaveValue("1500000");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(
    page.getByTestId("policy-builder").getByRole("status"),
  ).toContainText("revision 1");
  await page.reload();
  await page
    .getByText("Optional: custom rules & saved policies", { exact: true })
    .click();
  await page
    .getByLabel("Saved policies", { exact: true })
    .selectOption({ label: "Agent production · v1" });
  await expect(
    page.getByLabel("Maximum cumulative amount", { exact: true }),
  ).toHaveValue("1500000");
  await page
    .getByText("Advanced: voucher files & simulations", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load sample scenarios", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Verify 7 vouchers", exact: true })
    .click();
  await expect(page.locator(".workbench-results > details")).toHaveCount(7);
  const report = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download batch report", exact: true })
    .click();
  const path = await (await report).path();
  if (!path) throw Error("Missing report");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.results).toHaveLength(7);
  expect(exported.policy.maxCumulativeAmount).toBe("1500000");
  await page
    .getByLabel("Import policy or voucher", { exact: true })
    .setInputFiles("examples/valid.json");
  await expect(
    page.getByLabel("Expected channel identifier", { exact: true }),
  ).not.toHaveValue("");
  await page
    .getByLabel("Import voucher files", { exact: true })
    .setInputFiles("examples/valid.json");
  await page
    .getByRole("button", { name: "Verify 1 vouchers", exact: true })
    .click();
  await expect(page.locator(".workbench-results > details")).toHaveCount(1);
  await expect(page.locator(".workbench-results")).toContainText("PASS");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
});

test("Pro reviews a Solscan link without policy setup and exports fetched evidence", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
    toolsPath: "/pro.html",
  });
  const signature =
    "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
  const wire = await readFile("tests/fixtures/settle-tx.json", "utf8");
  let requests = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    requests++;
    expect(route.request().postDataJSON().params[0]).toBe(signature);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: wire,
    });
  });
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link", { exact: true })
    .fill(`https://solscan.io/tx/${signature}`);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("pro-transaction-result")).toContainText(
    "Transaction evidence verified",
  );
  expect(requests).toBe(1);
  await expect(page.getByTestId("pro-transaction-result")).not.toContainText(
    "Custom policy:",
  );
  const exportPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const path = await (await exportPromise).path();
  if (!path) throw Error("Missing review");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.results[0].review.result.signature).toBe(signature);
  expect(
    exported.results[0].review.result.voucherReport.evidence.messageHex,
  ).toBeTruthy();
  await page.getByLabel("Also check my custom policy", { exact: true }).check();
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("pro-transaction-result")).toContainText(
    "Custom policy: INDETERMINATE",
  );
  await expect(page.getByTestId("pro-transaction-result")).toContainText(
    "No independent signer authentication",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/pro-solscan.png",
    fullPage: true,
  });
});

test("Pro automatically highlights transaction fees, inner approvals and failed attempts from one link", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
    toolsPath: "/pro.html",
  });
  const signature =
    "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
  const wire = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  const { base58 } = await import("@scure/base");
  const data = new Uint8Array(9);
  data[0] = 4;
  new DataView(data.buffer).setBigUint64(1, 1000000n, true);
  wire.result.transaction.message.accountKeys.push(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  wire.result.meta.preBalances.push(1);
  wire.result.meta.postBalances.push(1);
  wire.result.meta.innerInstructions = [
    {
      index: 1,
      instructions: [
        { programIdIndex: 5, accounts: [1, 0, 0], data: base58.encode(data) },
      ],
    },
  ];
  // A synthetic permission instruction exercises the UI; this is not live-chain evidence.
  await page.route("**/api/solana-rpc", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(wire),
    }),
  );
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link", { exact: true })
    .fill(`https://solscan.io/tx/${signature}`);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  const insights = page.getByTestId("pro-insights");
  await expect(insights).toContainText("0.00001 SOL");
  await expect(insights).toContainText("-0.00001 SOL");
  await expect(insights).toContainText("Spending delegation");
  await expect(insights).toContainText("1000000 base units");
  await expect(insights).toContainText("Inner 1.1");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const path = await (await downloadPromise).path();
  if (!path) throw Error("Missing report");
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.results[0].review.insights.permissionEvents[0].action).toBe(
    "Spending delegation",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/pro-extra-checks.png",
    fullPage: true,
  });
  wire.result.meta.err = { InstructionError: [1, "test"] };
  wire.result.transaction.message.instructions = [];
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(insights).toContainText("attempted; transaction failed");
  await expect(insights).toContainText("not applied");
  await expect(page.getByTestId("pro-transaction-result")).toContainText(
    "Outside supported scope",
  );
  await expect(insights).toBeVisible();
});

test("local Pro history, cards and comparisons do not make extra RPC requests", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
  });
  const fixture = await readFile("tests/fixtures/settle-tx.json", "utf8");
  let requests = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: fixture,
    });
  });
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link")
    .fill(
      "https://solscan.io/tx/4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa",
    );
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save current reviews" }),
  ).toBeEnabled();
  const baseline = requests;
  await page.getByRole("button", { name: "Save current reviews" }).click();
  await page.getByRole("button", { name: "Save current reviews" }).click();
  await expect(page.locator(".pro-saved-report")).toHaveCount(2);
  await page
    .getByRole("checkbox", { name: "Compare", exact: true })
    .nth(0)
    .check();
  await page
    .getByRole("checkbox", { name: "Compare", exact: true })
    .nth(1)
    .check();
  await expect(
    page.getByRole("heading", { name: "Saved report comparison" }),
  ).toBeVisible();
  const cardPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download current card", exact: true })
    .click();
  const card = await cardPromise;
  const cardPath = await card.path();
  if (!cardPath) throw Error("Missing card");
  expect((await readFile(cardPath)).subarray(0, 8).toString("hex")).toBe(
    "89504e470d0a1a0a",
  );
  await page.reload();
  await expect(page.locator(".pro-saved-report")).toHaveCount(2);
  await page
    .getByRole("button", { name: "View saved summary" })
    .first()
    .click();
  await expect(page.locator(".pro-saved-report").first()).toContainText(
    "Historical snapshot",
  );
  expect(requests).toBe(baseline);
  await page.screenshot({
    path: "../VoucherGuard-Pro-local-reports.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear local history" }).click();
  await expect(page.locator(".pro-saved-report")).toHaveCount(0);
});

test("transaction rules persist and use existing RPC evidence with immutable exported preferences", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
  });
  const fixture = await readFile("tests/fixtures/settle-tx.json", "utf8");
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: fixture,
    });
  });
  await page.goto("./pro.html");
  await page.getByText(/My transaction rules/).click();
  await page
    .getByLabel("Maximum network fee / SOL (optional)")
    .fill("0.000001");
  await page.getByLabel("Maximum net SOL decrease (optional)").fill("0.05");
  await page.getByLabel("Flag net token decreases in my wallet").check();
  await page
    .getByRole("button", { name: "Save transaction preferences" })
    .click();
  expect(calls).toBe(0);
  const link =
    "https://solscan.io/tx/4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
  await page.getByLabel("Solscan transaction link").fill(link);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "Your rules flagged",
  );
  expect(calls).toBe(1);
  const replay = page.getByTestId("rule-replay");
  await replay.getByRole("button", { name: /^Strict/ }).click();
  await replay.getByLabel("Network fee cap / SOL").selectOption("");
  await replay
    .getByLabel("Flag spending delegations", { exact: true })
    .uncheck();
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "Your rules flagged",
  );
  const replayDownload = page.waitForEvent("download");
  await replay
    .getByRole("button", { name: "Export replay comparison" })
    .click();
  const replayPath = await (await replayDownload).path();
  if (!replayPath) throw Error("Missing replay export");
  const comparison = JSON.parse(await readFile(replayPath, "utf8"));
  expect(comparison.captured.rules.maxFeeSol).toBe("0.000001");
  expect(comparison.profiles.Strict.rules.maxFeeSol).toBe("");
  expect(comparison.profiles.Strict.rules.flagDelegations).toBe(false);
  expect(comparison.profiles.Custom.rules.maxFeeSol).toBe("0.000001");
  await replay.getByRole("button", { name: "Reset replay profiles" }).click();
  await expect(replay.getByLabel("Network fee cap / SOL")).toHaveValue(
    "0.0001",
  );
  expect(calls).toBe(1);
  await page.getByLabel("Maximum network fee / SOL (optional)").fill("0.00001");
  await page
    .getByRole("button", { name: "Use programs from current reviews" })
    .click();
  await page
    .getByRole("button", { name: "Save transaction preferences" })
    .click();
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "Your rules flagged",
  );
  expect(calls).toBe(1);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw Error("Missing export");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.results[0].review.transactionRules.rules.maxSolDecrease).toBe(
    "0.05",
  );
  expect(
    exported.results[0].review.transactionRules.rules.flagTokenDecreases,
  ).toBe(true);
  expect(exported.results[0].review.transactionRules.rules.maxFeeSol).toBe(
    "0.000001",
  );
  await page.reload();
  await page.getByText(/My transaction rules/).click();
  await expect(
    page.getByLabel("Maximum network fee / SOL (optional)"),
  ).toHaveValue("0.00001");
  await expect(
    page.getByLabel("Maximum net SOL decrease (optional)"),
  ).toHaveValue("0.05");
  await expect(
    page.getByLabel("Flag net token decreases in my wallet"),
  ).toBeChecked();
  await expect(page.getByLabel("Only allow my saved programs")).toBeChecked();
  expect(calls).toBe(1);
  await page.getByLabel("Solscan transaction link").fill(link);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "Some rule checks are incomplete",
  );
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "authenticated wallet",
  );
  expect(calls).toBe(2);
  await page.screenshot({
    path: "../VoucherGuard-Pro-transaction-rules.png",
    fullPage: true,
  });
});

test("Pro X-Ray flags saved personal rules without another transaction lookup", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
  });
  const fixture = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  const { base58 } = await import("@scure/base");
  fixture.result.transaction.message.accountKeys.push(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  const data = new Uint8Array(9);
  data[0] = 4;
  new DataView(data.buffer).setBigUint64(1, 1000000n, true);
  fixture.result.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        { programIdIndex: 5, accounts: [1, 0, 0], data: base58.encode(data) },
      ],
    },
  ];
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link")
    .fill(fixture.result.transaction.signatures[0]);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  const xray = page.getByTestId("transaction-xray");
  await expect(xray).toContainText("Pro preferences");
  const permissionMap = xray.getByTestId("permission-map");
  await permissionMap
    .getByRole("button", {
      name: /Spending delegation · recorded · Pro rule flagged/,
    })
    .click();
  await expect(
    permissionMap.getByRole("region", {
      name: "Selected permission connection",
    }),
  ).toContainText("matches captured Pro");
  await expect(permissionMap.locator(".map-rule-flag")).toHaveCount(1);
  expect(calls).toBe(1);
  const impact = xray.getByTestId("wallet-impact");
  await expect(impact).toContainText("Pro transaction rules:");
  const impactDownload = page.waitForEvent("download");
  await impact.getByRole("button", { name: "Export Wallet Impact" }).click();
  const impactPath = await (await impactDownload).path();
  if (!impactPath) throw Error("Missing Wallet Impact export");
  const exportedImpact = JSON.parse(await readFile(impactPath, "utf8"));
  expect(exportedImpact.wallet.address).toBe(
    fixture.result.transaction.message.accountKeys[0],
  );
  expect(exportedImpact.transactionRules).toBeDefined();
  expect(exportedImpact.signature).toBe(
    fixture.result.transaction.signatures[0],
  );
  expect(calls).toBe(1);
  await xray
    .getByRole("button", {
      name: "2 · Spending delegation · Flagged",
      exact: true,
    })
    .click();
  await expect(xray.locator(".xray-stage")).toHaveClass(/xray-flagged/);
  await expect(xray).toContainText("YOUR RULE FLAGGED THIS STEP");
  expect(calls).toBe(1);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const d = await pending;
  const path = await d.path();
  if (!path) throw Error("Missing export");
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.results[0].review.xray.steps[1].kind).toBe("permission");
  await xray.screenshot({ path: "../VoucherGuard-XRay-pro.png" });
  fixture.result.meta.err = { InstructionError: [0, { Custom: 6001 }] };
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(xray.getByTestId("failure-explanation")).toContainText(
    "Custom 6001 (0x1771)",
  );
  await expect(xray).toContainText("Pro preference alerts are separate checks");
  await xray.getByRole("button", { name: "Show failure point" }).click();
  await expect(xray.locator(".xray-stage")).toHaveClass(/xray-failed-step/);
  expect(calls).toBe(2);
  const failedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const failedPath = await (await failedDownload).path();
  if (!failedPath) throw Error("Missing failed export");
  const failedReport = JSON.parse(await readFile(failedPath, "utf8"));
  expect(failedReport.results[0].review.xray.failure.code).toBe(
    "Custom 6001 (0x1771)",
  );
});

test("personal token list imports existing wallet evidence, persists and exports without extra RPC", async ({
  page,
}) => {
  const owner = address(9);
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: owner,
  });
  const fixture = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  const mint = address(8);
  const tokenBalance = (amount: string) => ({
    accountIndex: 1,
    mint,
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  });
  fixture.result.meta.preTokenBalances = [tokenBalance("1000000")];
  fixture.result.meta.postTokenBalances = [tokenBalance("2000000")];
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link")
    .fill(fixture.result.transaction.signatures[0]);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await page.getByText(/My transaction rules/).click();
  await page
    .getByRole("button", { name: "Use tokens from my current reviews" })
    .click();
  await expect(page.getByLabel("Allowed token mint addresses")).toHaveValue(
    mint,
  );
  expect(calls).toBe(1);
  await page.getByLabel("Allowed token mint addresses").fill(address(7));
  await page
    .getByRole("button", { name: "Save transaction preferences" })
    .click();
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "Wallet allowed tokens",
  );
  await expect(page.getByTestId("transaction-rule-results")).toContainText(
    "not a scam or reputation verdict",
  );
  expect(calls).toBe(2);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download review", exact: true })
    .click();
  const path = await (await pending).path();
  if (!path) throw Error("Missing export");
  const report = JSON.parse(await readFile(path, "utf8"));
  expect(report.results[0].review.transactionRules.rules.allowedAssets).toEqual(
    [address(7)],
  );
  await page.reload();
  await page.getByText(/My transaction rules/).click();
  await expect(page.getByLabel("Allowed token mint addresses")).toHaveValue(
    address(7),
  );
  expect(calls).toBe(2);
});

test("Transaction DNA compares changed evidence and persists without extra RPC lookups", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { base58 } = await import("@scure/base");
  const fixture = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  fixture.result.transaction.message.accountKeys.push(
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    address(8),
  );
  const transfer = new Uint8Array(12);
  new DataView(transfer.buffer).setUint32(0, 2, true);
  new DataView(transfer.buffer).setBigUint64(4, 1000000000n, true);
  const approval = new Uint8Array(9);
  approval[0] = 4;
  new DataView(approval.buffer).setBigUint64(1, 1000000n, true);
  fixture.result.transaction.message.instructions = [
    { programIdIndex: 5, accounts: [0, 1], data: base58.encode(transfer) },
    { programIdIndex: 6, accounts: [1, 0, 0], data: base58.encode(approval) },
  ];
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    });
  });
  await page.goto("./pro.html");
  await page
    .getByLabel("Solscan transaction link")
    .fill(fixture.result.transaction.signatures[0]);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("transaction-dna")).toContainText("2 steps");
  await page.getByRole("button", { name: "Save current reviews" }).click();
  const comparison = page.getByTestId("dna-comparison");
  await expect(comparison).toContainText("2 matching operations");
  new DataView(transfer.buffer).setBigUint64(4, 2000000000n, true);
  fixture.result.transaction.message.instructions[0].data =
    base58.encode(transfer);
  fixture.result.transaction.message.instructions[1].accounts = [1, 2, 0];
  fixture.result.transaction.message.instructions.push({
    programIdIndex: 7,
    accounts: [0],
    data: "3",
  });
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(comparison).toContainText("1 modified");
  await expect(comparison).toContainText("2 added");
  await expect(comparison).toContainText("1 removed");
  await expect(comparison).toContainText(`Added reference: ${address(8)}`);
  await expect(comparison).toContainText("Coverage incomplete");
  const pending = page.waitForEvent("download");
  await comparison
    .getByRole("button", { name: "Export DNA comparison" })
    .click();
  const path = await (await pending).path();
  if (!path) throw Error("Missing DNA export");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.differences.changed[0].before.amount).toBe("1000000000");
  expect(exported.differences.changed[0].after.amount).toBe("2000000000");
  expect(exported.differences.addedPrograms).toEqual([address(8)]);
  expect(exported.differences.coverageIncomplete).toBe(true);
  expect(calls).toBe(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await comparison.screenshot({
    path: "../VoucherGuard-Transaction-DNA-Pro.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await comparison.screenshot({
    path: "../VoucherGuard-Transaction-DNA-mobile.png",
  });
  expect(
    await comparison.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Save current reviews" }).click();
  await page.reload();
  await expect(page.locator(".pro-saved-report")).toHaveCount(2);
  await expect(comparison).toContainText("1 modified");
  await comparison.getByLabel("DNA baseline").selectOption({ index: 1 });
  await expect(comparison).toContainText("1 modified");
  expect(calls).toBe(2);
});

test("Trade Journal preserves conditional FIFO, export and local history without extra RPC", async ({
  page,
}) => {
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: address(9),
  });
  const { base58 } = await import("@scure/base");
  const { USDC } = await import("../apps/web/src/xray/trade-receipt");
  const token = address(8),
    owner = address(9);
  const first = base58.encode(new Uint8Array(64).fill(40));
  const second = base58.encode(new Uint8Array(64).fill(41));
  const fixture = JSON.parse(
    await readFile("tests/fixtures/settle-tx.json", "utf8"),
  );
  fixture.result.transaction.message.accountKeys[0] = owner;
  fixture.result.transaction.message.accountKeys.push(
    token,
    address(6),
    USDC,
    address(5),
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
  fixture.result.meta.preBalances = Array(10).fill(1);
  fixture.result.meta.postBalances = Array(10).fill(1);
  fixture.result.meta.preBalances[0] = 2000000000;
  fixture.result.meta.postBalances[0] = 1999995000;
  fixture.result.meta.fee = 5000;
  const balance = (accountIndex: number, mint: string, amount: string) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const transfer = (from: number, to: number, amount: bigint) => {
    const b = new Uint8Array(9);
    b[0] = 3;
    new DataView(b.buffer).setBigUint64(1, amount, true);
    return {
      programIdIndex: 9,
      accounts: [from, to, 0],
      data: base58.encode(b),
    };
  };
  let calls = 0;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    const sig = route.request().postDataJSON().params[0];
    const sell = sig === second;
    const tx = structuredClone(fixture);
    tx.result.transaction.signatures = [sig];
    tx.result.slot = sell ? 101 : 100;
    tx.result.meta.preTokenBalances = [
      balance(6, token, sell ? "100000000" : "0"),
      balance(8, USDC, sell ? "900000000" : "1000000000"),
    ];
    tx.result.meta.postTokenBalances = [
      balance(6, token, sell ? "50000000" : "100000000"),
      balance(8, USDC, sell ? "960000000" : "900000000"),
    ];
    tx.result.transaction.message.instructions = sell
      ? [transfer(6, 1, 50000000n), transfer(1, 8, 60000000n)]
      : [transfer(1, 6, 100000000n), transfer(8, 1, 100000000n)];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tx),
    });
  });
  await page.goto("./pro.html");
  await page.getByLabel("Solscan transaction link").fill(`${first}\n${second}`);
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await expect(page.getByTestId("trade-receipt")).toHaveCount(2);
  const journal = page.getByTestId("trade-journal");
  await expect(journal).toContainText("Profit withheld");
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText(
    "Gross realized result before SOL network fees: 10 USDC",
  );
  await expect(journal).toContainText("Remaining cost: 50 USDC");
  expect(calls).toBe(2);
  const pending = page.waitForEvent("download");
  await journal
    .getByRole("button", { name: "Export Trade Journal evidence" })
    .click();
  const path = await (await pending).path();
  if (!path) throw Error("Missing journal export");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.journal.positions[0].realizedResult).toBe("10000000");
  expect(exported.journal.positions[0].costsIncludeNetworkFees).toBe(false);
  const csvPending = page.waitForEvent("download");
  await journal
    .getByRole("button", { name: "Export Trade Journal CSV" })
    .click();
  const csvPath = await (await csvPending).path();
  if (!csvPath) throw Error("Missing journal CSV");
  expect(await readFile(csvPath, "utf8")).toContain('"10000000"');
  await page.getByRole("button", { name: "Save current reviews" }).click();
  await expect(journal).toContainText("Profit withheld");
  await page.reload();
  await expect(journal).toContainText("Profit withheld");
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText(
    "Gross realized result before SOL network fees: 10 USDC",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await journal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await journal.screenshot({
    path: "../VoucherGuard-Trade-Journal-mobile.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await journal.screenshot({ path: "../VoucherGuard-Trade-Journal-Pro.png" });
  await journal.getByRole("checkbox").nth(0).uncheck();
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText("Opening token balance is nonzero");
  await expect(journal).toContainText("Profit withheld");
  expect(calls).toBe(2);
});

test("native SOL Journal reconciles cash and fees once, exports locally and withholds rent ambiguity", async ({
  page,
}) => {
  const owner = address(9),
    mint = address(8);
  await mockProStatus(page, {
    status: "eligible",
    message: "Verified",
    address: owner,
  });
  const { base58 } = await import("@scure/base");
  const signatures = [40, 41].map((n) =>
    base58.encode(new Uint8Array(64).fill(n)),
  );
  const transfer = (from: number, to: number, lamports: bigint) => {
    const b = new Uint8Array(12);
    new DataView(b.buffer).setUint32(0, 2, true);
    new DataView(b.buffer).setBigUint64(4, lamports, true);
    return { programIdIndex: 5, accounts: [from, to], data: base58.encode(b) };
  };
  let calls = 0,
    ambiguous = false;
  await page.route("**/api/solana-rpc", async (route) => {
    calls++;
    const sig = route.request().postDataJSON().params[0],
      sell = sig === signatures[1];
    const amount = sell ? 1200000000n : -1000000000n;
    const balance = (amount: string) => ({
      accountIndex: 2,
      mint,
      owner,
      uiTokenAmount: { amount, decimals: 6 },
    });
    const tokenTransfer = new Uint8Array(9);
    tokenTransfer[0] = 3;
    new DataView(tokenTransfer.buffer).setBigUint64(1, 100000000n, true);
    const instructions = [
      transfer(sell ? 1 : 0, sell ? 0 : 1, sell ? amount : -amount),
      {
        programIdIndex: 6,
        accounts: sell ? [2, 3, 0] : [3, 2, 1],
        data: base58.encode(tokenTransfer),
      },
    ];
    if (ambiguous && sell)
      instructions.push({
        programIdIndex: 6,
        accounts: [2, 0, 0],
        data: base58.encode(new Uint8Array([9])),
      });
    const tx = {
      slot: sell ? 101 : 100,
      blockTime: 1792000000 + (sell ? 1 : 0),
      transaction: {
        signatures: [sig],
        message: {
          accountKeys: [
            owner,
            address(2),
            address(3),
            address(4),
            mint,
            "11111111111111111111111111111111",
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          ],
          instructions,
        },
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [5000000000, 5000000000, 2039280, 2039280, 1, 1, 1],
        postBalances: [
          Number(5000000000n + amount - 5000n),
          Number(5000000000n - amount),
          2039280,
          2039280,
          1,
          1,
          1,
        ],
        preTokenBalances: [balance(sell ? "100000000" : "0")],
        postTokenBalances: [balance(sell ? "0" : "100000000")],
        innerInstructions: [],
        loadedAddresses: { writable: [], readonly: [] },
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: tx }),
    });
  });
  await page.goto("./pro.html");
  await page.getByLabel("Solscan transaction link").fill(signatures.join("\n"));
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  const journal = page.getByTestId("trade-journal");
  await expect(journal).toContainText("Profit withheld");
  await expect(page.getByTestId("trade-receipt").first()).toContainText(
    "Native SOL reconciled",
  );
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText(
    "Realized result including successful-trade network fees: 0.19999 SOL",
  );
  await expect(journal).toContainText("0.00001 SOL");
  const pending = page.waitForEvent("download");
  await journal
    .getByRole("button", { name: "Export Trade Journal evidence" })
    .click();
  const path = await (await pending).path();
  if (!path) throw Error("Missing native export");
  const exported = JSON.parse(await readFile(path, "utf8"));
  expect(exported.journal.positions[0].realizedResult).toBe("199990000");
  expect(exported.journal.receipts[0].nativeSol.transferNetLamports).toBe(
    "-1000000000",
  );
  expect(exported.journal.receipts[0].nativeSol.transfers).toHaveLength(1);
  expect(calls).toBe(2);
  await page
    .getByTestId("trade-receipt")
    .first()
    .screenshot({ path: "../VoucherGuard-Native-SOL-Receipt.png" });
  await journal.screenshot({ path: "../VoucherGuard-Native-SOL-Journal.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await journal.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Save current reviews" }).click();
  await page.reload();
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText("0.19999 SOL");
  expect(calls).toBe(2);
  await page.getByRole("button", { name: "Clear local history" }).click();
  ambiguous = true;
  await page.getByLabel("Solscan transaction link").fill(signatures.join("\n"));
  await page
    .getByRole("button", { name: "Play transaction", exact: true })
    .click();
  await journal.getByRole("checkbox", { name: /I confirm/ }).check();
  await expect(journal).toContainText("Profit withheld");
  const blocked = page.getByTestId("trade-receipt").nth(1);
  await blocked.getByText("Receipt scope & missing evidence").click();
  await expect(blocked).toContainText("rent/principal is not isolated");
  expect(calls).toBe(4);
});
