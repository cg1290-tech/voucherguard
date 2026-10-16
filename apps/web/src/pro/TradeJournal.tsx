import { serializeReport } from "@voucherguard/core";
import { useMemo, useState } from "react";
import { buildTradeReceipt, type TradeReceipt } from "../xray/trade-receipt";
import { downloadLocal, type LocalReport } from "./local-reports";
import { buildTradeJournal, journalCSV } from "./trade-journal";
import { displayUnits } from "./transaction-insights";
import type { TransactionReview } from "./transaction-review";

export function TradeJournal({
  reviews,
  reports,
  owner,
}: {
  reviews: TransactionReview[];
  reports: LocalReport[];
  owner: string;
}) {
  const [confirmedScope, setConfirmedScope] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const { receipts, unavailable } = useMemo(() => {
    const receipts: TradeReceipt[] = [];
    let unavailable = 0;
    const models: unknown[] = reviews.map((r) => r.xray);
    for (const report of reports) {
      try {
        if (report.evidence.length > 2_000_000) throw Error();
        const value = JSON.parse(report.evidence);
        models.push(value?.review?.xray);
      } catch {
        unavailable++;
      }
    }
    for (const model of models) {
      const r = buildTradeReceipt(model, owner);
      if (r) receipts.push(r);
      else unavailable++;
    }
    return { receipts, unavailable };
  }, [reviews, reports, owner]);
  const unique = [...new Map(receipts.map((r) => [r.signature, r])).values()];
  const included = receipts.filter((r) => !excluded.includes(r.signature));
  const scope = JSON.stringify({ owner, unavailable, receipts: included });
  const confirmed = confirmedScope === scope;
  const journal = buildTradeJournal(included, confirmed && unavailable === 0);
  return (
    <section className="trade-journal" data-testid="trade-journal">
      <p className="eyebrow">TRADE JOURNAL / PRO / LOCAL</p>
      <h3>Connect your trades. Keep the cost basis honest.</h3>
      <p>
        Uses current and saved reviews for your authenticated wallet. Save
        current reviews to keep them on this browser; up to 20 snapshots are
        retained. Repeated signatures count once. No automatic history scan,
        price feed or extra RPC request.
      </p>
      {unavailable > 0 && (
        <p role="status">
          {unavailable} review(s) lack usable wallet evidence. Results are
          withheld. Delete incomplete saved reports or load a fresh complete set
          yourself; no data is fetched automatically.
        </p>
      )}
      {unique.map((r) => (
        <label style={{ display: "block" }} key={r.signature}>
          <input
            type="checkbox"
            checked={!excluded.includes(r.signature)}
            onChange={(e) => {
              setConfirmedScope("");
              setExcluded(
                e.target.checked
                  ? excluded.filter((s) => s !== r.signature)
                  : [...excluded, r.signature],
              );
            }}
          />
          {r.signature.slice(0, 12)}… ·{" "}
          {r.candidate
            ? `${r.candidate.side} · ${r.candidate.quoteSymbol}`
            : r.execution === "failed"
              ? "Failed execution — fee only, not a trade"
              : "Unsupported / ambiguous receipt"}{" "}
          · Slot {r.slot ?? "unknown"}
        </label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!included.length || unavailable > 0}
          onChange={(e) => setConfirmedScope(e.target.checked ? scope : "")}
        />
        I confirm the included transactions are my trades and the imported
        history for these positions is complete, without external token
        transfers, unrelated SOL payments, rewards or rebases.
      </label>
      <p className="small muted">
        This is a user-supplied assumption, not an on-chain completeness check.
        Adding evidence or changing selection requires confirmation again.
        Balance continuity alone cannot prove complete trade history.
      </p>
      {!unique.length && (
        <p>
          Paste your buy and sell Solscan links in the review above. Save the
          reviews to build your journal over time.
        </p>
      )}
      {!journal.positions.length && unique.length > 0 && (
        <p>
          No supported token ↔ SOL/USDC/persistent WSOL position found.
          Unreconciled native SOL flows, newly created/closed token accounts,
          mixed quote currencies and ambiguous flows do not receive an invented
          cost basis.
        </p>
      )}
      {journal.positions.map((p) => (
        <article className="journal-position" key={p.token}>
          <h4>Token position</h4>
          <p>{p.token}</p>
          <p>
            Quote: {p.quoteSymbol} · FIFO · {p.signatures.length} imported
            trades
          </p>
          <div className="trade-legs">
            <div>
              Bought:{" "}
              {p.bought === null
                ? "Unknown"
                : displayUnits(p.bought, p.decimals)}
              <br />
              Sold:{" "}
              {p.sold === null ? "Unknown" : displayUnits(p.sold, p.decimals)}
            </div>
            <div>
              {p.status === "calculated" ? (
                <>
                  Remaining:{" "}
                  {p.remaining === null
                    ? "Unknown"
                    : displayUnits(p.remaining, p.decimals)}
                  <br />
                  Remaining cost:{" "}
                  {displayUnits(p.remainingCost ?? "0", p.quoteDecimals)}{" "}
                  {p.quoteSymbol}
                </>
              ) : (
                "Remaining cost: unknown"
              )}
            </div>
          </div>
          <p>
            <strong>
              {p.realizedResult === null
                ? "Profit withheld — acquisition cost or evidence incomplete"
                : `${p.costsIncludeNetworkFees ? "Realized result including successful-trade network fees" : "Gross realized result before SOL network fees"}: ${displayUnits(p.realizedResult, p.quoteDecimals)} ${p.quoteSymbol}`}
            </strong>
          </p>
          <p>
            Recorded network fees for these imported transactions:{" "}
            {p.networkFeesLamports === null
              ? "Unavailable"
              : `${displayUnits(p.networkFeesLamports, 9)} SOL`}
            .{" "}
            {p.status !== "calculated"
              ? "Cost allocation is withheld."
              : p.costsIncludeNetworkFees
                ? "Successful-trade network fees are allocated once to FIFO costs/proceeds in SOL units. Native transfer cash flows exclude the network fee; other recorded payments such as tips stay in the trade cash flow."
                : "USDC result excludes SOL fees: no historical exchange rate is available, so no conversion is invented."}
          </p>
          {p.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </article>
      ))}
      <div className="pro-link-actions">
        <button
          type="button"
          disabled={!unique.length}
          onClick={() =>
            downloadLocal(
              new Blob([journalCSV(journal)], {
                type: "text/csv;charset=utf-8",
              }),
              "voucherguard-trade-journal.csv",
            )
          }
        >
          Export Trade Journal CSV
        </button>
        <button
          type="button"
          disabled={!unique.length}
          onClick={() =>
            downloadLocal(
              new Blob(
                [
                  serializeReport({
                    journal,
                    excluded,
                    unavailable,
                    limitations:
                      "Conditional FIFO for user-confirmed imported successful trades only; not complete wallet profit, tax advice or independently authenticated history. USDC results exclude SOL fees. Native SOL requires recorded transfer/fee reconciliation without affected lifecycle operations. Excluded failed transaction fees and other trading expenses are not allocated. No current prices or unrealized profit.",
                  }),
                ],
                { type: "application/json" },
              ),
              "voucherguard-trade-journal.json",
            )
          }
        >
          Export Trade Journal evidence
        </button>
      </div>
      <details>
        <summary>Calculation limits</summary>
        <p>
          No current valuation, unrealized profit, slippage estimate or tax
          report. Failed transactions and excluded receipts are not allocated to
          positions. Partial FIFO lot costs round down to one quote base unit;
          the remainder stays with the lot and is consumed on final sale.
          Opening holdings, missing quantity continuity, unknown ordering,
          multiple trades in one slot, changed quote currencies and incomplete
          fee evidence withhold the result. Local evidence is unencrypted and
          editable; it is not independently certified.
        </p>
      </details>
    </section>
  );
}
