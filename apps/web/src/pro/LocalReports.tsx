import { useState } from "react";
import {
  comparison,
  downloadCard,
  downloadLocal,
  type LocalReport,
  readHistory,
  snapshot,
  writeHistory,
} from "./local-reports";
import type { TransactionReview } from "./transaction-review";
export function LocalReports({
  owner,
  reviews,
}: {
  owner: string;
  reviews: TransactionReview[];
}) {
  const [reports, setReports] = useState<LocalReport[]>(() => {
    try {
      return readHistory(owner, localStorage);
    } catch {
      return [];
    }
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<string>();
  function persist(next: LocalReport[]) {
    try {
      writeHistory(owner, next, localStorage);
      setReports(next.slice(0, 20));
      return true;
    } catch {
      setNotice(
        "Could not save on this device. Storage may be full or disabled. Download your report instead.",
      );
      return false;
    }
  }
  function save() {
    if (persist([...reviews.map(snapshot), ...reports]))
      setNotice("Saved on this device. No RPC request or upload was made.");
  }
  const pair = selected
    .map((id) => reports.find((r) => r.id === id))
    .filter((r): r is LocalReport => !!r);
  async function card(report: LocalReport) {
    try {
      await downloadCard(report);
      setNotice("Image downloaded. Share it with its full evidence report.");
    } catch {
      setNotice("Image export unavailable. Download the JSON report instead.");
    }
  }
  return (
    <section
      className="pro-local-reports"
      aria-labelledby="local-reports-title"
    >
      <p className="eyebrow">LOCAL / NO EXTRA RPC REQUESTS</p>
      <h2 id="local-reports-title">Keep and share your evidence.</h2>
      <p>
        Save up to 20 reviews on this browser, create a shareable image, or
        compare two saved reports.
      </p>
      <p className="small muted">
        Separate history for this wallet. Stored unencrypted on this device; not
        synced or independently certified. Clearing browser data removes it.
        Saving beyond 20 replaces the oldest reviews.
      </p>
      <div className="pro-link-actions">
        <button type="button" disabled={!reviews.length} onClick={save}>
          Save current reviews
        </button>
        <button
          type="button"
          disabled={!reviews.length}
          onClick={() => {
            if (reviews[0]) void card(snapshot(reviews[0]));
          }}
        >
          Download current card
        </button>
        <button
          type="button"
          disabled={!reports.length}
          onClick={() => {
            if (persist([])) {
              setSelected([]);
              setOpened(undefined);
              setNotice("Local history cleared.");
            }
          }}
        >
          Clear local history
        </button>
      </div>
      <p className="small muted">
        The current card uses the first reviewed transaction. Save multiple
        reviews to export each card individually.
      </p>
      <p role="status">{notice}</p>
      {reports.map((r) => (
        <article className="pro-saved-report" key={r.id}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              disabled={selected.length === 2 && !selected.includes(r.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, r.id]
                    : selected.filter((id) => id !== r.id),
                )
              }
            />{" "}
            Compare
          </label>
          <p>
            <strong>{r.signature.slice(0, 12)}…</strong> ·{" "}
            {new Date(r.savedAt).toLocaleString()}
            <br />
            {r.execution} · Voucher: {r.voucher} · Fee: {r.fee} · Rules:{" "}
            {r.transactionRules ?? "Not checked"}
          </p>
          <div className="pro-link-actions">
            <button
              type="button"
              onClick={() => setOpened(opened === r.id ? undefined : r.id)}
            >
              View saved summary
            </button>
            <button type="button" onClick={() => void card(r)}>
              Download card
            </button>
            <button
              type="button"
              onClick={() =>
                downloadLocal(
                  new Blob([r.evidence], { type: "application/json" }),
                  "voucherguard-saved-review.json",
                )
              }
            >
              Download evidence
            </button>
            <button
              type="button"
              onClick={() => {
                if (persist(reports.filter((x) => x.id !== r.id)))
                  setSelected(selected.filter((id) => id !== r.id));
              }}
            >
              Delete
            </button>
          </div>
          {opened === r.id && (
            <div>
              <p>Transaction: {r.signature}</p>
              <p>Custom policy: {r.policy}</p>
              <p>
                Transaction rules: {r.transactionRules ?? "Not checked"}.
                Captured preferences and checks are included in the downloaded
                evidence.
              </p>
              <h4>Recorded operations</h4>
              {r.operations.length ? (
                [...new Set(r.operations)].map((o) => <p key={o}>{o}</p>)
              ) : (
                <p>None decoded; this does not prove absence of permissions.</p>
              )}
              <h4>Coverage & warnings</h4>
              {[...new Set(r.coverage)].map((c) => (
                <p key={c}>{c}</p>
              ))}
              <p>
                Historical snapshot. Current wallet permissions were not
                checked.
              </p>
            </div>
          )}
        </article>
      ))}
      {!reports.length && <p>No saved reviews yet.</p>}
      {pair[0] && pair[1] && (
        <div className="pro-report-comparison">
          <h3>Saved report comparison</h3>
          <p>
            Recorded evidence, not live changes. Different transactions and
            custom policies may produce different results.
          </p>
          <div className="pro-compare-scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>First selected report</th>
                  <th>Second selected report</th>
                </tr>
              </thead>
              <tbody>
                {comparison(pair[0], pair[1]).map(([field, a, b]) => (
                  <tr key={field}>
                    <th>{field}</th>
                    <td>{a}</td>
                    <td>
                      {b}
                      {a !== b && <strong> · Different</strong>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
