import type { PolicyDocument } from "@voucherguard/core";
import { useState } from "react";
import fixtures from "../fixtures.json";
import {
  type BatchItem,
  type BatchResult,
  exportBatch,
  parseBatch,
  runBatch,
} from "./workspace";

export function Workbench({ policy }: { policy: PolicyDocument | undefined }) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [history, setHistory] = useState<
    { time: string; results: BatchResult[]; policy: PolicyDocument }[]
  >([]);
  async function load(files: FileList | null) {
    if (!files || busy) return;
    try {
      const selected = Array.from(files);
      if (
        selected.length > 100 ||
        selected.reduce((n, f) => n + f.size, 0) > 1024 * 1024
      )
        throw Error("Import up to 100 vouchers, 1 MiB total.");
      const imported = (
        await Promise.all(
          selected.map(async (f) => parseBatch(await f.text(), f.name)),
        )
      ).flat();
      if (imported.length > 100) throw Error("Maximum 100 vouchers per run.");
      setItems(imported);
      setResults([]);
      setNotice(
        `${imported.length} vouchers ready. Original bytes and supplied context are preserved.`,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Import failed.");
    }
  }
  async function run() {
    if (!policy || busy || !items.length) return;
    setBusy(true);
    try {
      const next = await runBatch(items, policy);
      setResults(next);
      setHistory((old) =>
        [
          { time: new Date().toISOString(), results: next, policy },
          ...old,
        ].slice(0, 10),
      );
      setNotice(
        "Run complete. Results use the policy selected when this run started.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const run = history[0];
    if (!run) return;
    const url = URL.createObjectURL(
      new Blob([exportBatch(run.results, run.policy)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "voucherguard-batch-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const counts = ["PASS", "FAIL", "INDETERMINATE", "INVALID"].map((status) => ({
    status,
    count: results.filter((r) => (r.report?.status ?? "INVALID") === status)
      .length,
  }));
  return (
    <section className="workbench" aria-labelledby="workbench-title">
      <div className="workbench-heading">
        <div>
          <p className="eyebrow">TEST & REVIEW</p>
          <h2 id="workbench-title">See your rules in action.</h2>
          <p>
            Drop in voucher files. Run them against your policy. Review the
            evidence together.
          </p>
        </div>
        <span className="workspace-badge">LOCAL VERIFICATION</span>
      </div>
      <div className="workbench-import">
        <label className="file-control">
          Import voucher files
          <input
            type="file"
            multiple
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              void load(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setItems(
              fixtures.map((f) => ({ name: f.name, document: f.document })),
            );
            setResults([]);
            setNotice(
              "Seven simulated scenarios loaded. Test keys only; these are not live payments.",
            );
          }}
        >
          Load sample scenarios
        </button>
        <button
          className="primary"
          type="button"
          disabled={!policy || !items.length || busy}
          onClick={() => void run()}
        >
          {busy ? "Verifying…" : `Verify ${items.length || ""} vouchers`}
        </button>
        <button
          type="button"
          disabled={!history.length || busy}
          onClick={download}
        >
          Download batch report
        </button>
      </div>
      <p className="small muted">
        Accepts one voucher per file or a JSON array. Up to 100 vouchers / 1
        MiB. Imported times are used when supplied; otherwise verification uses
        the current clock. Signer, expected channel and state must be
        independently authenticated. Batch checks do not advance watermarks
        between vouchers.
      </p>
      <p role="status" className="pro-notice">
        {notice}
      </p>
      <div className="workbench-counts">
        {counts.map((c) => (
          <button
            type="button"
            key={c.status}
            aria-pressed={filter === c.status}
            onClick={() => setFilter(filter === c.status ? "ALL" : c.status)}
          >
            <strong>{c.count}</strong>
            <span>{c.status}</span>
          </button>
        ))}
      </div>
      {!results.length && (
        <div className="workspace-empty">
          <h3>
            {items.length
              ? `${items.length} vouchers ready to check`
              : "Start with files or sample scenarios"}
          </h3>
          <p>
            Your results will show signature, amount, expiry and context checks
            for each voucher.
          </p>
        </div>
      )}
      <div className="workbench-results">
        {results
          .filter(
            (r) =>
              filter === "ALL" || (r.report?.status ?? "INVALID") === filter,
          )
          .map((r) => (
            <details key={r.id}>
              <summary>
                <span>{r.name}</span>
                <strong className={`result-${r.report?.status ?? "INVALID"}`}>
                  {r.report?.status ?? "INVALID"}
                </strong>
              </summary>
              {r.error ? (
                <p className="error">{r.error}</p>
              ) : (
                <>
                  <ul>
                    {r.report?.checks.map((c) => (
                      <li key={`${c.category}-${c.code}-${c.explanation}`}>
                        <strong>
                          {c.status} · {c.code}
                        </strong>
                        <p>{c.explanation}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">
                    {r.report?.limitations.join(" ")}
                  </p>
                </>
              )}
            </details>
          ))}
      </div>
      {history.length > 0 && (
        <details className="workbench-history">
          <summary>Recent runs · {history.length}</summary>
          <p className="small muted">
            Kept in memory for this visit only. Download a report to retain it.
          </p>
          {history.map((h) => (
            <p key={h.time}>
              {new Date(h.time).toLocaleTimeString()} · {h.results.length}{" "}
              vouchers ·{" "}
              {h.results.filter((r) => r.report?.status === "PASS").length}{" "}
              passed
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
