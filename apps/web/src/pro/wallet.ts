import { encodeBytes } from "@voucherguard/core";
import type { Wallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsFeature,
} from "@wallet-standard/features";

type ReadWallet = Wallet & StandardConnectFeature & StandardEventsFeature;
function compatible(wallet: Wallet): wallet is ReadWallet {
  if (
    wallet?.version !== "1.0.0" ||
    !Array.isArray(wallet.chains) ||
    !wallet.features ||
    typeof wallet.features !== "object"
  )
    return false;
  const connect = wallet.features[StandardConnect] as
    | Partial<StandardConnectFeature[typeof StandardConnect]>
    | undefined;
  const events = wallet.features[StandardEvents] as
    | Partial<StandardEventsFeature[typeof StandardEvents]>
    | undefined;
  return (
    wallet.chains.some(
      (c) => typeof c === "string" && c.startsWith("solana:"),
    ) &&
    connect?.version === "1.0.0" &&
    typeof connect.connect === "function" &&
    events?.version === "1.0.0" &&
    typeof events.on === "function"
  );
}
function validAccounts(
  accounts: readonly WalletAccount[],
): readonly WalletAccount[] {
  if (!Array.isArray(accounts)) return [];
  return accounts.filter(
    (a) =>
      a &&
      Array.isArray(a.chains) &&
      a.publicKey instanceof Uint8Array &&
      a.publicKey.length === 32 &&
      encodeBytes(a.publicKey, "base58") === a.address &&
      a.chains.some(
        (c: unknown) => typeof c === "string" && c.startsWith("solana:"),
      ),
  );
}
export interface WalletSnapshot {
  wallets: readonly ReadWallet[];
  wallet: ReadWallet | null;
  accounts: readonly WalletAccount[];
  account: WalletAccount | null;
  connecting: boolean;
  error: string;
  revision: number;
}
const SOLANA_SIGN_MESSAGE = "solana:signMessage";

type SignMessageFeature = {
  version: string;
  signMessage: (input: {
    account: WalletAccount;
    message: Uint8Array;
  }) => Promise<readonly { signature: Uint8Array }[]>;
};

/** Wallet Standard connect + optional Solana message signing for Pro sessions. */
export class WalletController {
  private snapshot: WalletSnapshot;
  private readonly listeners = new Set<() => void>();
  private stopEvents: (() => void) | undefined;
  private stops: (() => void)[] = [];
  private request = 0;
  constructor(private readonly registry: Wallets) {
    this.snapshot = {
      wallets: registry.get().filter(compatible),
      wallet: null,
      accounts: [],
      account: null,
      connecting: false,
      error: "",
      revision: 0,
    };
  }
  getSnapshot = (): WalletSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      const changed = () => {
        const wallets = this.registry.get().filter(compatible);
        if (this.snapshot.wallet && !wallets.includes(this.snapshot.wallet))
          this.forget();
        this.update({ wallets });
      };
      this.stops = [
        this.registry.on("register", changed),
        this.registry.on("unregister", changed),
      ];
      changed();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        for (const stop of this.stops) stop();
        this.stops = [];
        this.stopEvents?.();
        this.stopEvents = undefined;
        this.request++;
        this.snapshot = {
          ...this.snapshot,
          wallet: null,
          accounts: [],
          account: null,
          connecting: false,
          revision: this.snapshot.revision + 1,
        };
      }
    };
  };
  private update(patch: Partial<WalletSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  private forget(): void {
    this.request++;
    this.stopEvents?.();
    this.stopEvents = undefined;
    this.update({
      wallet: null,
      accounts: [],
      account: null,
      connecting: false,
      error: "",
    });
  }
  private setAccounts(accounts: readonly WalletAccount[]): void {
    const valid = validAccounts(accounts);
    const account =
      valid.find((a) => a.address === this.snapshot.account?.address) ??
      valid[0] ??
      null;
    this.update({ accounts: valid, account });
  }
  async connect(wallet: Wallet): Promise<void> {
    this.forget();
    if (!compatible(wallet) || !this.registry.get().includes(wallet)) {
      this.update({
        error:
          "This wallet does not support the required read-only Wallet Standard features.",
      });
      return;
    }
    const request = ++this.request;
    this.update({ wallet, connecting: true, error: "" });
    try {
      const events = wallet.features[
        StandardEvents
      ] as StandardEventsFeature[typeof StandardEvents];
      const connect = wallet.features[
        StandardConnect
      ] as StandardConnectFeature[typeof StandardConnect];
      this.stopEvents = events.on("change", (changes) => {
        if (request !== this.request) return;
        // Any provider event invalidates a previous balance check, including account/chain changes.
        if (changes.accounts !== undefined) this.setAccounts(changes.accounts);
        else this.update({});
      });
      const result = await connect.connect();
      if (request !== this.request) return;
      this.setAccounts(result.accounts);
      this.update({
        connecting: false,
        error: this.snapshot.account
          ? ""
          : "The wallet did not provide a valid Solana account.",
      });
    } catch {
      if (request === this.request) {
        this.forget();
        this.update({
          error: "Wallet connection was declined or failed. You can try again.",
        });
      }
    }
  }
  selectAccount(address: string): void {
    const account = this.snapshot.accounts.find((a) => a.address === address);
    if (account) this.update({ account, error: "" });
  }
  async disconnect(): Promise<void> {
    const wallet = this.snapshot.wallet;
    this.forget();
    const feature = wallet?.features[StandardDisconnect] as
      | StandardDisconnectFeature[typeof StandardDisconnect]
      | undefined;
    try {
      if (
        feature?.version === "1.0.0" &&
        typeof feature.disconnect === "function"
      )
        await feature.disconnect();
    } catch {
      this.update({
        error:
          "Disconnected locally. Revoke the site connection in your wallet if needed.",
      });
    }
  }
  /** Sign a Pro access challenge. Required only for holder-session unlock. */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { wallet, account } = this.snapshot;
    if (!wallet || !account)
      throw new Error("Connect a Solana wallet before proving holdings.");
    const feature = wallet.features[SOLANA_SIGN_MESSAGE] as
      | SignMessageFeature
      | undefined;
    if (
      !feature ||
      typeof feature.signMessage !== "function" ||
      (feature.version !== "1.0.0" && feature.version !== "1.1.0")
    )
      throw new Error(
        "This wallet cannot sign messages required for Pro holder verification.",
      );
    const output = await feature.signMessage({ account, message });
    const signature = output[0]?.signature;
    if (!(signature instanceof Uint8Array) || signature.length !== 64)
      throw new Error("Wallet returned an invalid message signature.");
    return signature;
  }
}

export type { Wallets } from "@wallet-standard/app";
export type { Wallet, WalletAccount } from "@wallet-standard/base";
export type { StandardEventsListeners } from "@wallet-standard/features";
