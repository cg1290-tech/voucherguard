const CHAIN = "eip155:4663";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const ROBINHOOD_NAMESPACES = {
  eip155: {
    chains: [CHAIN],
    methods: ["personal_sign"],
    events: ["accountsChanged", "chainChanged"],
  },
};
export function robinhoodAccount(namespaces: unknown): string {
  if (!namespaces || typeof namespaces !== "object")
    throw new Error("Wallet session is unavailable");
  const evm = (namespaces as Record<string, unknown>).eip155;
  if (!evm || typeof evm !== "object")
    throw new Error("Wallet does not support Robinhood Chain");
  const data = evm as { accounts?: unknown; methods?: unknown };
  if (
    !Array.isArray(data.accounts) ||
    !Array.isArray(data.methods) ||
    !data.methods.includes("personal_sign")
  )
    throw new Error("Wallet must support authentication messages");
  const account = data.accounts.find(
    (a: unknown) =>
      typeof a === "string" &&
      a.startsWith(`${CHAIN}:`) &&
      ADDRESS.test(a.slice(CHAIN.length + 1)),
  );
  if (typeof account !== "string")
    throw new Error("Choose a Robinhood Chain account in your wallet");
  const address = account.slice(CHAIN.length + 1).toLowerCase();
  if (/^0x0{40}$/.test(address)) throw new Error("Invalid wallet account");
  return address;
}
export interface RobinhoodConnection {
  address: string;
  sign(message: string): Promise<string>;
  disconnect(): Promise<void>;
  dispose(): void;
}
export async function connectRobinhood(
  projectId: string,
  onUri: (uri: string) => void,
  onInvalidated: () => void,
): Promise<RobinhoodConnection> {
  if (!/^[0-9a-f]{32}$/i.test(projectId))
    throw new Error("Wallet connection is not configured yet");
  const { SignClient } = await import("@walletconnect/sign-client");
  const client = await SignClient.init({
    projectId,
    telemetryEnabled: false,
    logger: "error",
    metadata: {
      name: "VoucherGuard",
      description:
        "Verify $VG holdings to access Pro. No payment or token approvals.",
      url: "https://voucherguard.pages.dev",
      icons: ["https://voucherguard.pages.dev/voucherguard-logo.jpg"],
    },
  });
  const { uri, approval } = await client.connect({
    requiredNamespaces: ROBINHOOD_NAMESPACES,
  });
  if (uri) onUri(uri);
  const session = await approval();
  let address: string;
  try {
    address = robinhoodAccount(session.namespaces);
  } catch (e) {
    await client.disconnect({
      topic: session.topic,
      reason: { code: 6000, message: "Unsupported wallet session" },
    });
    throw e;
  }
  let active = true;
  const invalidate = () => {
    if (active) {
      active = false;
      onInvalidated();
    }
  };
  const updated = (event: { topic: string }) => {
    if (event.topic === session.topic) invalidate();
  };
  client.on("session_update", updated);
  client.on("session_event", updated);
  client.on("session_delete", updated);
  const dispose = () => {
    client.off("session_update", updated);
    client.off("session_event", updated);
    client.off("session_delete", updated);
  };
  return {
    address,
    async sign(message) {
      if (
        !active ||
        robinhoodAccount(client.session.get(session.topic).namespaces) !==
          address
      )
        throw new Error("Wallet account changed. Reconnect to continue.");
      const payload = `0x${[...new TextEncoder().encode(message)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      const result: unknown = await client.request({
        topic: session.topic,
        chainId: CHAIN,
        request: { method: "personal_sign", params: [payload, address] },
      });
      if (
        !active ||
        typeof result !== "string" ||
        !/^0x[0-9a-fA-F]{130}$/.test(result)
      )
        throw new Error("Wallet proof was canceled or invalid");
      return result;
    },
    async disconnect() {
      active = false;
      dispose();
      await client.disconnect({
        topic: session.topic,
        reason: { code: 6000, message: "User disconnected" },
      });
    },
    dispose,
  };
}
