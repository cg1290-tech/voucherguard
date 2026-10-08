import type { Page } from "@playwright/test";
import { address } from "./pro-fixtures";
export async function installWallet(page: Page) {
  await page.addInitScript(
    ({ a, b }) => {
      const make = (value: string, byte: number, chain = "solana:mainnet") => ({
        address: value,
        publicKey: new Uint8Array(32).fill(byte),
        chains: [chain],
        features: [],
      });
      let accounts = [make(a, 9)];
      let listener:
        | ((props: { accounts: typeof accounts }) => void)
        | undefined;
      const forbidden = () => {
        throw new Error("A signing or transaction method was called.");
      };
      const wallet = {
        version: "1.0.0",
        name: "VoucherGuard Browser Test Wallet",
        icon: "data:image/png;base64,",
        chains: ["solana:mainnet", "solana:devnet"],
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => ({ accounts }),
          },
          "standard:events": {
            version: "1.0.0",
            on: (_name: string, cb: typeof listener) => {
              listener = cb;
              return () => {
                listener = undefined;
              };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {},
          },
          "solana:signMessage": { signMessage: forbidden },
          "solana:signTransaction": { signTransaction: forbidden },
          "solana:signAndSendTransaction": {
            signAndSendTransaction: forbidden,
          },
        },
      };
      const register = ({
        register,
      }: {
        register: (...wallets: unknown[]) => unknown;
      }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", ((
        event: CustomEvent,
      ) => register(event.detail)) as EventListener);
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: register,
        }),
      );
      window.addEventListener("vg-test-control", ((
        event: CustomEvent<string>,
      ) => {
        accounts =
          event.detail === "devnet"
            ? [make(a, 9, "solana:devnet")]
            : event.detail === "account-b"
              ? [make(b, 10)]
              : event.detail === "disconnected"
                ? []
                : [make(a, 9)];
        listener?.({ accounts });
      }) as EventListener);
    },
    { a: address(9), b: address(10) },
  );
}
