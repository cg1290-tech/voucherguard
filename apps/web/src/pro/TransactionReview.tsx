import type { PolicyDocument } from "@voucherguard/core";
import { serializeReport } from "@voucherguard/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { TransactionXRay } from "../xray/TransactionXRay";
import { LocalReports } from "./LocalReports";
import { proApiBase } from "./pro-session";
import { TransactionInsights } from "./TransactionInsights";
import { RulePreferences, RuleResults } from "./TransactionRules";
import {
  type TransactionReview as Review,
  reviewTransaction,
  transactionLinks,
} from "./transaction-review";
import {
  DEFAULT_RULES,
  evaluateRules,
  loadRules,
  saveRules,
  type TransactionRules,
} from "./transaction-rules";

type Row = { signature: string; review?: Review; error?: string };
const RPC = `${proApiBase()}/api/solana-rpc`;
export function TransactionReview({
  policy,
  owner,
}: {
  owner: string;
  policy: PolicyDocument | undefined;
}) {
  const [initialRules] = useState(() => {
    try {
      return loadRules(owner, localStorage);
    } catch {
      return {
        rules: structuredClone(DEFAULT_RULES),
        saved: false,
        notice:
          "Local storage unavailable. Preferences apply only for this visit.",
      };
    }
  });
  const [rules, setRules] = useState(initialRules.rules);
  const [rulesSaved, setRulesSaved] = useState(initialRules.saved);
  const [rulesNotice, setRulesNotice] = useState(initialRules.notice);
  function storeRules(next: TransactionRules) {
    setRules(next);
    try {
      saveRules(owner, next, localStorage);
      setRulesSaved(true);
      setRulesNotice(
        "Preferences saved. They will apply automatically to the next review.",
      );
    } catch {
      setRulesSaved(false);
      setRulesNotice(
        "Storage unavailable. These preferences are active for this visit only; they could not be saved.",
      );
    }
  }
  const [input, setInput] = useState("");
  const [usePolicy, setUsePolicy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abort.current?.abort(), []);
  async function run(event: FormEvent) {
    event.preventDefault();
    let signatures: string[];
    try {
      signatures = transactionLinks(input);
      if (usePolicy && !policy)
        throw Error("Fix your custom policy or turn off custom rules.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Invalid link.");
      setRows([]);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const capturedRules = structuredClone(rules);
    const captured = usePolicy && policy ? structuredClone(policy) : undefined;
    setBusy(true);
    setRows([]);
    setNotice("Reading confirmed transactions…");
    const next: Row[] = [];
    for (const signature of signatures) {
      if (controller.signal.aborted) break;
      try {
        const fetcher: typeof fetch = (url, init) =>
          fetch(url, {
            ...init,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15000),
            ]),
          });
        const review = await reviewTransaction(
          signature,
          RPC,
          captured,
          fetcher,
        );
        review.transactionRules = evaluateRules(review.insights, capturedRules);
        next.push({ signature, review });
      } catch (e) {
        if (controller.signal.aborted) break;
        next.push({
          signature,
          error:
            e instanceof Error
              ? e.message
              : "Transaction unavailable. Try again.",
        });
      }
      if (!controller.signal.aborted) setRows([...next]);
    }
    if (!controller.signal.aborted) {
      setBusy(false);
      setNotice(
        `Review complete · ${next.length} transaction${next.length === 1 ? "" : "s"}.`,
      );
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          serializeReport({
            version: 1,
            mode: "historical-transaction-review",
            exportedAt: new Date().toISOString(),
            results: rows,
            limitations: [
              "Transaction evidence is historical. It does not certify current spendability, independent signer authorization or absence of concurrent replay.",
            ],
          }),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "voucherguard-transaction-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="pro-link-review" aria-labelledby="pro-link-title">
      <p className="eyebrow">START HERE</p>
      <h2 id="pro-link-title">One link. A clear review.</h2>
      <p>
        Paste a Solscan transaction link. Check recorded balances, costs and
        selected permissions, plus payment voucher evidence when present. No
        files or technical setup needed.
      </p>
      <RulePreferences
        rules={rules}
        saved={rulesSaved}
        busy={busy}
        notice={rulesNotice}
        onSave={storeRules}
        programs={rows.flatMap((row) => row.review?.insights.programs ?? [])}
      />
      <form onSubmit={(e) => void run(e)}>
        <label htmlFor="pro-transaction-link">Solscan transaction link</label>
        <textarea
          id="pro-transaction-link"
          rows={2}
          spellCheck={false}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://solscan.io/tx/…"
        />
        <div className="pro-link-actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || !input.trim()}
          >
            {busy ? "Loading…" : "Play transaction"}
          </button>
          <button
            type="button"
            disabled={busy || !rows.length}
            onClick={download}
          >
            Download review
          </button>
        </div>
        <p className="small muted">
          Multiple transactions? Paste up to 20 links, one per line. Solana
          mainnet transaction links only; token and wallet pages are not
          transaction evidence.
        </p>
        <label className="pro-link-policy">
          <input
            type="checkbox"
            checked={usePolicy}
            disabled={busy}
            onChange={(e) => setUsePolicy(e.target.checked)}
          />{" "}
          Also check my custom policy
        </label>
        <p className="small muted">
          Custom voucher policies apply to supported payment-channel vouchers.
          Your transaction rules apply to every reviewed transaction.
        </p>
      </form>
      <p role="status" className="pro-notice">
        {notice}
      </p>
      <div className="pro-link-results">
        {rows.map((row) => {
          const result = row.review?.result;
          return (
            <article key={row.signature} data-testid="pro-transaction-result">
              <a
                href={`https://solscan.io/tx/${row.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction {row.signature.slice(0, 10)}… ↗
              </a>
              {row.review?.xray && (
                <TransactionXRay
                  model={row.review.xray}
                  rules={row.review.transactionRules}
                  autoPlay={row.signature === rows[0]?.signature}
                />
              )}
              {row.review?.transactionRules && (
                <RuleResults report={row.review.transactionRules} />
              )}
              {row.review?.insights && (
                <TransactionInsights insights={row.review.insights} />
              )}
              {row.error ? (
                <p role="alert">{row.error}</p>
              ) : result?.kind !== "historical" ? (
                <>
                  <h3>
                    {result?.kind === "unsupported"
                      ? "Outside supported scope"
                      : "Transaction unavailable"}
                  </h3>
                  <p>{result?.message}</p>
                  <p className="small muted">
                    Voucher proof is limited to Payment Channels V1 settlements.
                    Pro still shows recorded transaction effects above for swaps
                    and transfers. These findings are not a safety
                    certification.
                  </p>
                </>
              ) : (
                <>
                  <h3>
                    {!result.success
                      ? "Transaction failed on-chain"
                      : result.voucherReport.status === "PASS"
                        ? "Transaction evidence verified"
                        : "Evidence needs review"}
                  </h3>
                  <dl className="pro-link-facts">
                    <div>
                      <dt>On-chain result</dt>
                      <dd>{result.success ? "Confirmed success" : "Failed"}</dd>
                    </div>
                    <div>
                      <dt>Voucher signature</dt>
                      <dd>
                        {result.voucherReport.checks.find(
                          (c) =>
                            c.code === "SIGNATURE_VALID" ||
                            c.code === "SIGNATURE_INVALID",
                        )?.status ?? "Not verified"}
                      </dd>
                    </div>
                    <div>
                      <dt>Settlement</dt>
                      <dd>{result.settlement}</dd>
                    </div>
                    <div>
                      <dt>Confirmed slot</dt>
                      <dd>{result.slot}</dd>
                    </div>
                  </dl>
                  {row.review?.policyReport && (
                    <p>
                      Custom policy:{" "}
                      <strong>{row.review.policyReport.status}</strong>
                    </p>
                  )}
                  {row.review?.policyNotice && (
                    <p className="small muted">{row.review.policyNotice}</p>
                  )}
                  <details>
                    <summary>Evidence & checks</summary>
                    <p className="small muted">
                      Channel: {result.channelId}
                      <br />
                      Signer extracted from transaction:{" "}
                      {result.authorizedSigner}
                      <br />
                      Amount in base units: {result.cumulativeAmount}
                    </p>
                    {[
                      ...result.voucherReport.checks.map((c) => ({
                        ...c,
                        source: "transaction",
                      })),
                      ...(row.review?.policyReport?.checks ?? []).map((c) => ({
                        ...c,
                        source: "policy",
                      })),
                    ].map((c) => (
                      <p
                        key={`${c.source}-${c.category}-${c.code}-${c.explanation}`}
                      >
                        <strong>
                          {c.status} · {c.code}
                        </strong>
                        <br />
                        {c.explanation}
                      </p>
                    ))}
                  </details>
                  <p className="small muted">
                    {result.notice} The signer and channel shown are extracted
                    transaction evidence, not independently authenticated
                    application context.
                  </p>
                </>
              )}
            </article>
          );
        })}
      </div>
      <LocalReports
        key={owner}
        owner={owner}
        reviews={rows.flatMap((row) => (row.review ? [row.review] : []))}
      />
    </section>
  );
}
