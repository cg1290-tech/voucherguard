import { describe, expect, it, vi } from "vitest";
import type {
  StandardEventsListeners,
  Wallet,
  Wallets,
} from "../apps/web/src/pro/wallet";
import { WalletController } from "../apps/web/src/pro/wallet";
import { account } from "./pro-fixtures";

function fixture() {
  let accounts = [account()];
  let change: StandardEventsListeners["change"] | undefined;
  const disconnect = vi.fn(async () => {});
  const sign = vi.fn(() => {
    throw Error("Signing is forbidden");
  });
  const wallet: Wallet = {
    version: "1.0.0",
    name: "Fixture wallet",
    icon: "data:image/png;base64,",
    chains: ["solana:mainnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: vi.fn(async () => ({ accounts })),
      },
      "standard:events": {
        version: "1.0.0",
        on: (_event: string, listener: StandardEventsListeners["change"]) => {
          change = listener;
          return () => {
            change = undefined;
          };
        },
      },
      "standard:disconnect": { version: "1.0.0", disconnect },
      "solana:signMessage": { signMessage: sign },
      "solana:signTransaction": { signTransaction: sign },
    },
  };
  const registry: Wallets = {
    get: () => [wallet],
    on: () => () => {},
    register: () => () => {},
  };
  return {
    wallet,
    registry,
    sign,
    disconnect,
    update: () => {
      accounts = [account(10)];
      change?.({ accounts });
    },
  };
}
describe("read-only Wallet Standard controller", () => {
  it("discovers compatible wallets without connecting or signing", () => {
    const f = fixture();
    const c = new WalletController(f.registry);
    expect(c.getSnapshot().wallets).toEqual([f.wallet]);
    expect(c.getSnapshot().account).toBeNull();
    expect(f.sign).not.toHaveBeenCalled();
  });
  it("connects and invalidates on account changes", async () => {
    const f = fixture();
    const c = new WalletController(f.registry);
    const stop = c.subscribe(() => {});
    await c.connect(f.wallet);
    const before = c.getSnapshot().revision;
    expect(c.getSnapshot().account?.address).toBe(account().address);
    f.update();
    expect(c.getSnapshot().account?.address).toBe(account(10).address);
    expect(c.getSnapshot().revision).toBeGreaterThan(before);
    expect(f.sign).not.toHaveBeenCalled();
    stop();
  });
  it("disconnect clears the account immediately and uses no signing", async () => {
    const f = fixture();
    const c = new WalletController(f.registry);
    const stop = c.subscribe(() => {});
    await c.connect(f.wallet);
    const pending = c.disconnect();
    expect(c.getSnapshot().account).toBeNull();
    await pending;
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.sign).not.toHaveBeenCalled();
    stop();
  });
  it("late connection responses cannot restore a disconnected account", async () => {
    const f = fixture();
    let resolve:
      | ((v: { accounts: ReturnType<typeof account>[] }) => void)
      | undefined;
    const wallet: Wallet = {
      ...f.wallet,
      features: {
        ...f.wallet.features,
        "standard:connect": {
          version: "1.0.0",
          connect: () =>
            new Promise<{ accounts: ReturnType<typeof account>[] }>((r) => {
              resolve = r;
            }),
        },
      },
    };
    const c = new WalletController({ ...f.registry, get: () => [wallet] });
    const stop = c.subscribe(() => {});
    const pending = c.connect(wallet);
    await c.disconnect();
    resolve?.({ accounts: [account()] });
    await pending;
    expect(c.getSnapshot().account).toBeNull();
    stop();
  });
  it("refuses wallets without account change notifications", async () => {
    const f = fixture();
    const wallet = {
      ...f.wallet,
      features: { "standard:connect": f.wallet.features["standard:connect"] },
    };
    const c = new WalletController({
      get: () => [wallet],
      on: () => () => {},
      register: () => () => {},
    });
    await c.connect(wallet);
    expect(c.getSnapshot().account).toBeNull();
    expect(c.getSnapshot().error).toContain("required read-only");
  });
});
