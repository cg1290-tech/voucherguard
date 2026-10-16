import { receiptEligible, type TradeReceipt } from "../xray/trade-receipt";
import { displayUnits } from "./transaction-insights";
export interface JournalPosition {
  token: string;
  decimals: number;
  quote: string;
  quoteSymbol: string;
  quoteDecimals: number;
  status: "calculated" | "withheld";
  reasons: string[];
  signatures: string[];
  bought: string | null;
  sold: string | null;
  remaining: string | null;
  remainingCost: string | null;
  realizedResult: string | null;
  proceeds: string | null;
  allocatedCost: string | null;
  networkFeesLamports: string | null;
  costsIncludeNetworkFees: boolean;
}
/** FIFO on user-confirmed, imported simple trades only. Currency arithmetic stays integer.
 * Proportional lot cost rounds down in quote base units; remainder stays in the lot.
 */
export function buildTradeJournal(
  receipts: TradeReceipt[],
  confirmed: boolean,
) {
  const bySignature = new Map<string, TradeReceipt>(),
    conflicts = new Set<string>();
  for (const r of receipts) {
    const previous = bySignature.get(r.signature);
    if (previous && JSON.stringify(previous) !== JSON.stringify(r))
      conflicts.add(r.signature);
    else bySignature.set(r.signature, r);
  }
  const unique = [...bySignature.values()];
  const globalReasons = [
    ...(!confirmed
      ? [
          "Confirm that these are trades and that this position’s imported history is complete, with no external transfers, rewards or rebases.",
        ]
      : []),
    ...(unique.some((r) => !r.candidate)
      ? [
          "An included receipt is not a supported simple trade. Review or exclude it explicitly; profit is withheld.",
        ]
      : []),
    ...(conflicts.size
      ? ["Conflicting evidence exists for a repeated transaction signature."]
      : []),
    ...(new Set(unique.map((r) => r.owner)).size > 1
      ? ["Receipts belong to different wallets."]
      : []),
  ];
  const groups = new Map<string, TradeReceipt[]>();
  for (const r of unique) {
    if (!r.candidate) continue;
    const key = r.candidate.token.asset;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  const positions: JournalPosition[] = [];
  for (const [token, group] of groups) {
    group.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const first = group[0]?.candidate;
    if (!first) continue;
    const reasons = [...globalReasons];
    const quantityPrecisionKnown = group.every(
      (r) => r.candidate?.token.decimals === first.token.decimals,
    );
    if (group.some((r) => !receiptEligible(r)))
      reasons.push(
        "Missing balance coverage, ordering, fee ownership or isolated native SOL costs.",
      );
    if (
      group.some(
        (r) =>
          r.candidate?.quote.asset !== first.quote.asset ||
          r.candidate.token.decimals !== first.token.decimals ||
          r.candidate.quote.decimals !== first.quote.decimals,
      )
    )
      reasons.push(
        "Mixed quote currencies or conflicting precision; no currency conversion is inferred.",
      );
    if (new Set(group.map((r) => r.slot)).size !== group.length)
      reasons.push(
        "Trades share a slot; their transaction order is unavailable.",
      );
    if (BigInt(first.token.before) !== 0n)
      reasons.push(
        "Opening token balance is nonzero: earlier acquisition cost is missing.",
      );
    const accountScope = JSON.stringify([...first.token.accounts].sort());
    if (
      group.some(
        (r) =>
          JSON.stringify([...(r.candidate?.token.accounts ?? [])].sort()) !==
          accountScope,
      )
    )
      reasons.push(
        "Token account coverage changes across imported trades; wallet-wide inventory is not established.",
      );
    for (let i = 1; i < group.length; i++)
      if (
        group[i - 1]?.candidate?.token.after !==
        group[i]?.candidate?.token.before
      )
        reasons.push(
          "Token balances are discontinuous between imported trades; history or transfers are missing.",
        );
    let bought = 0n,
      sold = 0n,
      proceeds = 0n,
      allocatedCost = 0n,
      fees = 0n;
    const lots: { quantity: bigint; cost: bigint }[] = [];
    for (const r of group) {
      const c = r.candidate;
      if (!c) continue;
      const quantity =
        BigInt(c.token.change) < 0n
          ? -BigInt(c.token.change)
          : BigInt(c.token.change);
      const cash =
        BigInt(c.quote.change) < 0n
          ? -BigInt(c.quote.change)
          : BigInt(c.quote.change);
      const fee = BigInt(r.feeLamports ?? "0");
      fees += fee;
      const sameCurrencyFee = c.quoteSymbol === "WSOL" ? fee : 0n;
      if (c.side === "buy") {
        bought += quantity;
        lots.push({ quantity, cost: cash + sameCurrencyFee });
      } else {
        sold += quantity;
        proceeds += cash - sameCurrencyFee;
        let left = quantity;
        while (left > 0n && lots.length) {
          const lot = lots[0];
          if (!lot) break;
          const take = left < lot.quantity ? left : lot.quantity;
          const cost = (lot.cost * take) / lot.quantity;
          allocatedCost += cost;
          lot.cost -= cost;
          lot.quantity -= take;
          left -= take;
          if (lot.quantity === 0n) lots.shift();
        }
        if (left > 0n)
          reasons.push("Sale exceeds acquisitions with known cost basis.");
      }
    }
    const remaining = lots.reduce((n, l) => n + l.quantity, 0n),
      remainingCost = lots.reduce((n, l) => n + l.cost, 0n);
    if (group.at(-1)?.candidate?.token.after !== remaining.toString())
      reasons.push(
        "Remaining inventory does not match the recorded final token balance.",
      );
    const known = reasons.length === 0;
    positions.push({
      token,
      decimals: first.token.decimals,
      quote: first.quote.asset,
      quoteSymbol: first.quoteSymbol,
      quoteDecimals: first.quote.decimals,
      status: known ? "calculated" : "withheld",
      reasons: [...new Set(reasons)],
      signatures: group.map((r) => r.signature),
      bought: quantityPrecisionKnown ? bought.toString() : null,
      sold: quantityPrecisionKnown ? sold.toString() : null,
      remaining: !quantityPrecisionKnown
        ? null
        : known
          ? remaining.toString()
          : (group.at(-1)?.candidate?.token.after ?? "0"),
      remainingCost: known ? remainingCost.toString() : null,
      realizedResult: known ? (proceeds - allocatedCost).toString() : null,
      proceeds: known ? proceeds.toString() : null,
      allocatedCost: known ? allocatedCost.toString() : null,
      networkFeesLamports: group.some((r) => r.feeLamports === null)
        ? null
        : fees.toString(),
      costsIncludeNetworkFees: first.quoteSymbol === "WSOL",
    });
  }
  return {
    version: 1,
    method: "FIFO",
    confirmed,
    positions,
    globalReasons,
    receipts: unique,
  };
}
export function journalCSV(journal: ReturnType<typeof buildTradeJournal>) {
  const rows: unknown[][] = [
    [
      "Token mint",
      "Quote",
      "Status",
      "Bought base units",
      "Sold base units",
      "Remaining base units",
      "Realized result quote base units",
      "Remaining cost quote base units",
      "Network fees lamports",
      "Network fees included",
      "Reasons",
      "Token decimals",
      "Quote decimals",
      "Bought tokens",
      "Sold tokens",
      "Remaining tokens",
      "Realized result quote units",
      "Remaining cost quote units",
      "Network fees SOL",
    ],
  ];
  for (const p of journal.positions)
    rows.push([
      p.token,
      p.quoteSymbol,
      p.status,
      p.bought ?? "",
      p.sold ?? "",
      p.remaining ?? "",
      p.realizedResult ?? "",
      p.remainingCost ?? "",
      p.networkFeesLamports ?? "",
      p.costsIncludeNetworkFees,
      p.reasons.join("; "),
      p.decimals,
      p.quoteDecimals,
      p.bought === null ? "" : displayUnits(p.bought, p.decimals),
      p.sold === null ? "" : displayUnits(p.sold, p.decimals),
      p.remaining === null ? "" : displayUnits(p.remaining, p.decimals),
      p.realizedResult === null
        ? ""
        : displayUnits(p.realizedResult, p.quoteDecimals),
      p.remainingCost === null
        ? ""
        : displayUnits(p.remainingCost, p.quoteDecimals),
      p.networkFeesLamports === null
        ? ""
        : displayUnits(p.networkFeesLamports, 9),
    ]);
  // All text is quoted and spreadsheet formula prefixes are neutralized.
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            `"${String(v)
              .replace(/^[=+@\t\r]/, "'$&")
              .replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
}
