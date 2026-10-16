import { base58 } from "@scure/base";
import { type NativeSolEvidence, nativeSolFlow } from "./native-sol";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL = "So11111111111111111111111111111111111111112";
export interface ReceiptLeg {
  asset: string;
  decimals: number;
  before: string;
  after: string;
  change: string;
  accounts: string[];
}
export interface TradeReceipt {
  signature: string;
  owner: string;
  slot: number | null;
  blockTime: number | null;
  execution: "succeeded" | "failed" | "unknown";
  feeLamports: string | null;
  feePayer: string;
  balances: ReceiptLeg[];
  notes: string[];
  nativeSol?: {
    observedNetLamports: string;
    transferNetLamports: string;
    feeLamports: string;
    transfers: NativeSolEvidence["transfers"];
  };
  candidate?: {
    token: ReceiptLeg;
    quote: Pick<ReceiptLeg, "asset" | "decimals" | "change" | "accounts">;
    side: "buy" | "sell";
    quoteSymbol: "USDC" | "WSOL" | "SOL";
  };
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const address = (v: unknown) => {
  try {
    return (
      typeof v === "string" && v.length <= 44 && base58.decode(v).length === 32
    );
  } catch {
    return false;
  }
};
const amount = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,30}$/.test(v);
const signed = (v: unknown): v is string =>
  typeof v === "string" && /^-?\d{1,30}$/.test(v);
/** Validate local evidence too. No assumptions of zero for absent balances. */
export function buildTradeReceipt(
  value: unknown,
  owner: string,
): TradeReceipt | undefined {
  const model = obj(value),
    impact = obj(model.walletImpact);
  if (
    !address(owner) ||
    !Array.isArray(impact.wallets) ||
    impact.wallets.length > 512 ||
    !Array.isArray(impact.gaps) ||
    impact.gaps.length > 500 ||
    !impact.gaps.every((g) => typeof g === "string" && g.length <= 2000)
  )
    return undefined;
  const matches = impact.wallets.map(obj).filter((w) => w.address === owner);
  const wallet = matches[0];
  if (
    matches.length !== 1 ||
    !wallet ||
    !Array.isArray(wallet.balances) ||
    wallet.balances.length > 512
  )
    return undefined;
  const balances: ReceiptLeg[] = [],
    seen = new Set<string>();
  for (const entry of wallet.balances) {
    const b = obj(entry);
    if (
      (b.asset !== "SOL" && !address(b.asset)) ||
      typeof b.asset !== "string" ||
      seen.has(b.asset) ||
      !Number.isInteger(b.decimals) ||
      Number(b.decimals) < 0 ||
      Number(b.decimals) > 255 ||
      !amount(b.before) ||
      !amount(b.after) ||
      !signed(b.change) ||
      BigInt(b.after) - BigInt(b.before) !== BigInt(b.change) ||
      !Array.isArray(b.accounts) ||
      b.accounts.length > 256 ||
      !b.accounts.every(address)
    )
      return undefined;
    seen.add(b.asset);
    balances.push({
      asset: b.asset,
      decimals: Number(b.decimals),
      before: b.before,
      after: b.after,
      change: b.change,
      accounts: [...b.accounts] as string[],
    });
  }
  const execution =
    impact.execution === "succeeded" || impact.execution === "failed"
      ? impact.execution
      : "unknown";
  const notes = [...impact.gaps] as string[];
  const receipt: TradeReceipt = {
    signature: typeof impact.signature === "string" ? impact.signature : "",
    owner,
    slot:
      Number.isSafeInteger(model.slot) && Number(model.slot) >= 0
        ? Number(model.slot)
        : null,
    blockTime:
      Number.isSafeInteger(model.blockTime) && Number(model.blockTime) >= 0
        ? Number(model.blockTime)
        : null,
    execution,
    feeLamports: amount(impact.feeLamports) ? impact.feeLamports : null,
    feePayer: typeof impact.feePayer === "string" ? impact.feePayer : "",
    balances,
    notes,
  };
  try {
    if (
      receipt.signature.length > 88 ||
      base58.decode(receipt.signature).length !== 64
    )
      notes.push("Transaction signature unavailable or malformed.");
  } catch {
    notes.push("Transaction signature unavailable or malformed.");
  }
  if (model.execution !== impact.execution)
    notes.push("Execution evidence is inconsistent.");
  const tokens = balances.filter(
    (b) => b.asset !== "SOL" && BigInt(b.change) !== 0n,
  );
  const quotes = tokens.filter(
    (b) =>
      (b.asset === USDC && b.decimals === 6) ||
      (b.asset === WSOL && b.decimals === 9),
  );
  const sol = balances.find((b) => b.asset === "SOL" && b.decimals === 9);
  if (execution !== "succeeded")
    notes.push(
      "Only successful executions can form a journal trade. Failed transaction fees remain separate.",
    );
  if (tokens.length === 2 && quotes.length === 1 && execution === "succeeded") {
    const quote = quotes[0],
      token = tokens.find((b) => b !== quote);
    if (
      quote &&
      token &&
      BigInt(quote.change) < 0n !== BigInt(token.change) < 0n
    ) {
      receipt.candidate = {
        token,
        quote,
        side: BigInt(token.change) > 0n ? "buy" : "sell",
        quoteSymbol: quote.asset === USDC ? "USDC" : "WSOL",
      };
    }
  }
  if (
    tokens.length === 1 &&
    tokens[0]?.asset !== WSOL &&
    execution === "succeeded" &&
    sol &&
    receipt.feeLamports !== null &&
    receipt.feePayer === owner
  ) {
    const flow = nativeSolFlow(model.nativeSol, owner),
      token = tokens[0];
    if (flow.net === null) notes.push(...flow.reasons);
    else if (
      BigInt(sol.change) + BigInt(receipt.feeLamports) !==
      BigInt(flow.net)
    )
      notes.push(
        "Native SOL transfers do not reconcile with the recorded wallet change plus network fee; unexplained lamport effects remain.",
      );
    else if (
      token &&
      BigInt(flow.net) !== 0n &&
      BigInt(token.change) < 0n !== BigInt(flow.net) < 0n
    ) {
      receipt.candidate = {
        token,
        quote: {
          asset: "SOL",
          decimals: 9,
          change: flow.net,
          accounts: [owner],
        },
        side: BigInt(token.change) > 0n ? "buy" : "sell",
        quoteSymbol: "SOL",
      };
      receipt.nativeSol = {
        observedNetLamports: sol.change,
        transferNetLamports: flow.net,
        feeLamports: receipt.feeLamports,
        transfers: flow.transfers ?? [],
      };
    }
  }
  if (!receipt.candidate)
    notes.push(
      "No supported simple trade established. Native SOL needs complete transfer evidence, exact balance/fee reconciliation and no affected account lifecycle operations.",
    );
  if (
    receipt.feeLamports === null ||
    receipt.feePayer !== owner ||
    !sol ||
    (receipt.candidate?.quoteSymbol !== "SOL" &&
      BigInt(sol.change) !== -BigInt(receipt.feeLamports))
  )
    notes.push(
      "Network fee ownership or other native SOL effects are not isolated; journal cost basis withheld.",
    );
  if (receipt.slot === null)
    notes.push("Ordering metadata unavailable. Reloading is never automatic.");
  notes.push(
    "Opposing balance changes are a trade candidate, not proof of a swap. Journal calculations require your confirmation of complete trade history without external transfers, unrelated SOL payments, rewards or rebases.",
  );
  return receipt;
}
export function receiptEligible(r: TradeReceipt) {
  return (
    !!r.candidate &&
    r.slot !== null &&
    r.feeLamports !== null &&
    r.notes.length === 1
  );
}
export function receiptRate(r: TradeReceipt): string | undefined {
  const c = r.candidate;
  if (!c) return undefined;
  const token =
    BigInt(c.token.change) < 0n
      ? -BigInt(c.token.change)
      : BigInt(c.token.change);
  const quote =
    BigInt(c.quote.change) < 0n
      ? -BigInt(c.quote.change)
      : BigInt(c.quote.change);
  // Floor to 9 decimal places. Never use floating-point token arithmetic.
  return (
    (quote * 10n ** BigInt(c.token.decimals) * 1000000000n) /
    (token * 10n ** BigInt(c.quote.decimals))
  ).toString();
}
export function receiptOwners(value: unknown): string[] {
  const wallets = obj(obj(value).walletImpact).wallets;
  return Array.isArray(wallets) && wallets.length <= 512
    ? wallets
        .map(obj)
        .map((w) => w.address)
        .filter((a): a is string => typeof a === "string" && address(a))
    : [];
}
