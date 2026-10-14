import { serializeReport } from "@voucherguard/core";
import { useId, useMemo, useState } from "react";
import { DNAOperationDetails, DNAVisual } from "../xray/TransactionDNA";
import {
  buildTransactionDNA,
  compareTransactionDNA,
  savedTransactionDNA,
  type TransactionDNA,
} from "../xray/transaction-dna";
import { downloadLocal, type LocalReport } from "./local-reports";
import type { TransactionReview } from "./transaction-review";

interface Candidate {
  id: string;
  label: string;
  signature: string;
  dna: TransactionDNA;
}
export function TransactionDNACompare({
  reviews,
  reports,
}: {
  reviews: TransactionReview[];
  reports: LocalReport[];
}) {
  const id = useId();
  const [baselineId, setBaselineId] = useState("");
  const [currentId, setCurrentId] = useState("");
  const { candidates, unavailable } = useMemo(() => {
    const candidates: Candidate[] = [];
    let unavailable = 0;
    for (const [i, review] of reviews.entries()) {
      const dna = buildTransactionDNA(review.xray);
      if (dna)
        candidates.push({
          id: `current-${i}-${review.signature}`,
          label: `Current ${i + 1} · ${review.signature.slice(0, 12)}…`,
          signature: review.signature,
          dna,
        });
      else unavailable++;
    }
    for (const [i, report] of reports.entries()) {
      const dna = savedTransactionDNA(report.evidence);
      if (dna)
        candidates.push({
          id: `saved-${i}-${report.id}`,
          label: `Saved · ${report.signature.slice(0, 12)}… · ${new Date(report.savedAt).toLocaleString()}`,
          signature: report.signature,
          dna,
        });
      else unavailable++;
    }
    return { candidates, unavailable };
  }, [reviews, reports]);
  const baseline =
    candidates.find((c) => c.id === baselineId) ??
    candidates.find((c) => c.id.startsWith("saved-")) ??
    candidates[0];
  const current =
    candidates.find((c) => c.id === currentId && c.id !== baseline?.id) ??
    candidates.find((c) => c.id !== baseline?.id);
  const diff =
    baseline && current
      ? compareTransactionDNA(baseline.dna, current.dna)
      : undefined;
  return (
    <section className="dna-workspace" data-testid="dna-comparison">
      <p className="eyebrow">TRANSACTION DNA / PRO COMPARISON</p>
      <h3>What changed in the transaction?</h3>
      <p>
        Choose a loaded transaction or saved review as your baseline. Compare
        ordered operations, exact amounts, permission targets and referenced
        programs locally. No transaction is fetched again.
      </p>
      {unavailable > 0 && (
        <p>
          {unavailable} review(s) have no usable X-Ray evidence. Older or
          malformed saved reports are excluded; no evidence is inferred or
          refetched.
        </p>
      )}
      {candidates.length < 2 ? (
        <p>
          Save a review, then load another transaction to compare DNA. You can
          also compare two saved reviews on this device.
        </p>
      ) : (
        <>
          <div className="dna-selectors">
            <label htmlFor={`${id}-baseline`}>
              DNA baseline
              <select
                id={`${id}-baseline`}
                value={baseline?.id ?? ""}
                onChange={(e) => setBaselineId(e.target.value)}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${id}-current`}>
              DNA comparison transaction
              <select
                id={`${id}-current`}
                value={current?.id ?? ""}
                onChange={(e) => setCurrentId(e.target.value)}
              >
                {candidates
                  .filter((c) => c.id !== baseline?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {baseline && current && diff && (
            <>
              <div className="dna-diff-counts" role="status">
                <span>{diff.matching} matching operations</span>
                <span>{diff.changed.length} modified</span>
                <span>{diff.added.length} added</span>
                <span>{diff.removed.length} removed</span>
              </div>
              <p>
                {diff.sameFingerprint
                  ? "Same scoped evidence fingerprint."
                  : "Different scoped evidence fingerprints."}{" "}
                Matching DNA does not establish identical transaction bytes or
                safety.
              </p>
              <p>
                Execution: {baseline.dna.execution} → {current.dna.execution}.{" "}
                {diff.sequenceChanged
                  ? "Ordered operation structure differs."
                  : "Ordered operation structure matches; amounts and execution states are compared separately."}
              </p>
              {diff.coverageIncomplete && (
                <p>
                  Coverage incomplete: differences describe available evidence
                  only. An operation missing from this comparison may be absent
                  from the trace, rather than absent on-chain.
                </p>
              )}
              <div className="dna-diff-grid">
                <div>
                  <h4>Baseline DNA</h4>
                  <DNAVisual dna={baseline.dna} />
                </div>
                <div>
                  <h4>Comparison DNA</h4>
                  <DNAVisual dna={current.dna} />
                </div>
              </div>
              <h4>Program changes</h4>
              {diff.addedPrograms.length || diff.removedPrograms.length ? (
                <ul>
                  {diff.addedPrograms.map((p) => (
                    <li key={`add-${p}`}>Added reference: {p}</li>
                  ))}
                  {diff.removedPrograms.map((p) => (
                    <li key={`remove-${p}`}>Removed reference: {p}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  No differences in the resolved program inventories. This does
                  not audit the programs.
                </p>
              )}
              <h4>
                Modified amounts or execution states · {diff.changed.length}
              </h4>
              {diff.changed.map(({ before, after }) => (
                <details key={after.position}>
                  <summary>
                    {after.label} · {before.amount ?? "No amount"} →{" "}
                    {after.amount ?? "No amount"} base units · {before.state} →{" "}
                    {after.state}
                  </summary>
                  <DNAOperationDetails operation={before} />
                  <DNAOperationDetails operation={after} />
                </details>
              ))}
              <h4>Added operations · {diff.added.length}</h4>
              {diff.added.map((op) => (
                <DNAOperationDetails key={op.position} operation={op} />
              ))}
              <h4>Removed operations · {diff.removed.length}</h4>
              {diff.removed.map((op) => (
                <DNAOperationDetails key={op.position} operation={op} />
              ))}
              <button
                type="button"
                onClick={() =>
                  downloadLocal(
                    new Blob(
                      [
                        serializeReport({
                          version: 1,
                          mode: "historical-transaction-dna-comparison",
                          exportedAt: new Date().toISOString(),
                          baseline: {
                            signature: baseline.signature,
                            dna: baseline.dna,
                          },
                          comparison: {
                            signature: current.signature,
                            dna: current.dna,
                          },
                          differences: diff,
                          limitations:
                            "Local comparison of scoped historical evidence, not raw transaction identity, current permissions or a safety verdict. Missing coverage remains explicit.",
                        }),
                      ],
                      { type: "application/json" },
                    ),
                    "voucherguard-transaction-dna.json",
                  )
                }
              >
                Export DNA comparison
              </button>
            </>
          )}
        </>
      )}
      <p className="small muted">
        Permission target changes appear as removed and added operations;
        repeated operations are counted separately. Only identical operation
        context is paired for amount/state changes. Program lists are
        references, not reputation checks. Local reports are unencrypted and can
        be edited; fingerprints do not certify their authenticity.
      </p>
    </section>
  );
}
