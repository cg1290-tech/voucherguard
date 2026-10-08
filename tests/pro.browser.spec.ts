import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { MAINNET_GENESIS, TOKEN_PROGRAM } from "../apps/web/src/pro/config";
import { installWallet } from "./pro.browser-support";
import { address, TEST_MINT } from "./pro-fixtures";

interface RpcState {
  amount: string;
  fail: boolean;
  genesis: string;
  delay: number;
  calls: string[];
}
async function installRpc(page: Page, patch: Partial<RpcState> = {}) {
  const state: RpcState = {
    amount: "1000000",
    fail: false,
    genesis: MAINNET_GENESIS,
    delay: 0,
    calls: [],
    ...patch,
  };
  await page.route("https://voucherguard-rpc.example.test/", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      id: number;
      method: string;
      params: unknown[];
    };
    state.calls.push(body.method);
    if (state.fail) {
      await route.fulfill({
        status: 429,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "rate limited",
      });
      return;
    }
    let result: unknown;
    if (body.method === "getGenesisHash") result = state.genesis;
    else if (body.method === "getAccountInfo")
      result = {
        context: { slot: 1000 },
        value: {
          owner: TOKEN_PROGRAM,
          executable: false,
          data: {
            parsed: {
              type: "mint",
              info: { decimals: 6, isInitialized: true },
            },
          },
        },
      };
    else if (body.method === "getTokenAccountsByOwner") {
      const owner = String(body.params[0]);
      const amount = owner === address(9) ? state.amount : "0";
      result = {
        context: { slot: 1001 },
        value: [
          {
            pubkey: address(20),
            account: {
              owner: TOKEN_PROGRAM,
              executable: false,
              data: {
                parsed: {
                  type: "account",
                  info: {
                    mint: TEST_MINT,
                    owner,
                    state: "initialized",
                    tokenAmount: { amount, decimals: 6, uiAmount: 99999999 },
                  },
                },
              },
            },
          },
        ],
      };
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, state.delay));
    } else throw new Error(`Unexpected RPC method: ${body.method}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    });
  });
  return state;
}
async function connect(page: Page) {
  await page.goto("./");
  await page
    .locator("#pro")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
}
async function change(page: Page, account: string) {
  await page.evaluate(
    (value) =>
      window.dispatchEvent(
        new CustomEvent("vg-test-control", { detail: value }),
      ),
    account,
  );
}

test("eligible policy builder validates, copies, downloads and applies without altering signed voucher fields", async ({
  page,
  context,
}) => {
  await installWallet(page);
  const rpc = await installRpc(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  await expect(page.getByTestId("policy-builder")).toBeVisible();
  const original = JSON.parse(
    await page
      .getByLabel("Signed voucher payload", { exact: true })
      .inputValue(),
  );
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
    builder.getByRole("button", { name: "Apply to playground" }),
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
    .getByRole("button", { name: "Apply to playground", exact: true })
    .click();
  await expect(builder.getByRole("status")).toContainText("preserved");
  const applied = JSON.parse(
    await page
      .getByLabel("Signed voucher payload", { exact: true })
      .inputValue(),
  );
  const { policy: _p, ...actual } = applied;
  const { policy: _o, ...expected } = original;
  expect(actual).toEqual(expected);
  await page
    .getByRole("button", { name: "Verify locally", exact: true })
    .click();
  await expect(page.getByTestId("status")).toHaveText("FAIL");
  await expect(page.locator(".checks")).toContainText("AMOUNT_LIMIT");
  await builder
    .getByRole("button", { name: "Conservative example", exact: true })
    .click();
  await expect(
    builder.getByLabel("Maximum authorized increase", { exact: true }),
  ).toHaveValue("100000");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator("#pro")
    .screenshot({ path: "docs/pro-policy-builder-test.png" });
  await builder
    .getByRole("button", { name: "Reset builder", exact: true })
    .click();
  await expect(
    builder.getByLabel("Maximum cumulative amount", { exact: true }),
  ).toHaveValue("");
  expect(rpc.calls).toEqual([
    "getGenesisHash",
    "getAccountInfo",
    "getTokenAccountsByOwner",
  ]);
});
test("RPC failure stays locked and manual refresh recovers", async ({
  page,
}) => {
  await installWallet(page);
  const rpc = await installRpc(page, { fail: true });
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Access could not be verified",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
  rpc.fail = false;
  await page
    .getByRole("button", { name: "Refresh access", exact: true })
    .click();
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
});
test("zero holdings cannot unlock", async ({ page }) => {
  await installWallet(page);
  await installRpc(page, { amount: "0" });
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Holder threshold not met",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
});
test("incorrect RPC genesis hash cannot unlock", async ({ page }) => {
  await installWallet(page);
  await installRpc(page, { genesis: "wrong-network" });
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Unsupported network",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
});
test("account switches revoke access and re-check the new wallet", async ({
  page,
}) => {
  await installWallet(page);
  const rpc = await installRpc(page);
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  await change(page, "account-b");
  await expect(page.getByTestId("policy-builder")).toBeHidden();
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Holder threshold not met",
  );
  await change(page, "account-a");
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  expect(rpc.calls).toHaveLength(9);
  await page
    .getByRole("button", { name: "Disconnect wallet", exact: true })
    .click();
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Connect to check access",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
});
test("a delayed old account response cannot reopen access after a switch", async ({
  page,
}) => {
  await installWallet(page);
  const rpc = await installRpc(page, { delay: 500 });
  await connect(page);
  await expect
    .poll(() => rpc.calls.includes("getTokenAccountsByOwner"))
    .toBe(true);
  await change(page, "account-b");
  await expect(page.getByTestId("policy-builder")).toBeHidden();
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Holder threshold not met",
  );
  await page.waitForTimeout(650);
  await expect(page.getByTestId("policy-builder")).toBeHidden();
});
test("wallet network changes remain closed, and builder is responsive", async ({
  page,
}) => {
  await installWallet(page);
  await installRpc(page);
  await connect(page);
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Pro unlocked",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await change(page, "devnet");
  await expect(page.getByTestId("pro-access-status")).toHaveText(
    "Unsupported network",
  );
  await expect(page.getByTestId("policy-builder")).toBeHidden();
});
