import { useMemo, useState } from "react";
import { displayUnits } from "../pro/transaction-insights";
import type { XRayModel } from "./model";
import {
  buildTransactionDNA,
  type DNAOperation,
  type TransactionDNA,
} from "./transaction-dna";
import "./transaction-dna.css";

export function DNAOperationDetails({
  operation: op,
}: {
  operation: DNAOperation;
}) {
  return (
    <div className="dna-operation-details">
      <strong>
        {op.position} · {op.label} · {op.state}
      </strong>
      <p>Program: {op.program || "Unresolved"}</p>
      {op.from && <p>From / account: {op.from}</p>}
      {op.to && <p>To / target: {op.to}</p>}
      {op.amount !== null && (
        <p>
          Amount / allowance:{" "}
          {op.decimals === null
            ? `${op.amount} base units · precision unknown`
            : displayUnits(op.amount, op.decimals)}{" "}
          · {op.asset || "Asset unknown"}
        </p>
      )}
      {op.action && <p>Permission operation: {op.action}</p>}
      {op.kind === "unknown" && (
        <p>
          Undecoded instruction. Referenced accounts:{" "}
          {op.accounts.join(", ") || "Unavailable"}. Raw instruction data is
          retained in the exported DNA; no behavior is inferred.
        </p>
      )}
    </div>
  );
}
export function DNAVisual({ dna }: { dna: TransactionDNA }) {
  const [selected, setSelected] = useState("");
  const active = dna.operations.find((op) => op.position === selected);
  const width = Math.max(360, dna.operations.length * 48 + 48);
  const wave = (x: number, opposite = false) =>
    82 + Math.sin(x / 44) * (opposite ? -46 : 46);
  const strand = (opposite: boolean) =>
    Array.from(
      { length: Math.ceil(width / 8) + 1 },
      (_, i) => `${i * 8},${wave(i * 8, opposite)}`,
    ).join(" ");
  return (
    <>
      <div className="dna-helix-scroll">
        <svg
          className="dna-helix"
          width={width}
          height="164"
          viewBox={`0 0 ${width} 164`}
          aria-hidden="true"
        >
          <polyline
            points={strand(false)}
            fill="none"
            stroke="#83b263"
            strokeWidth="2"
          />
          <polyline
            points={strand(true)}
            fill="none"
            stroke="#628cab"
            strokeWidth="2"
          />
          {dna.operations.map((op) => {
            const x = 32 + dna.operations.indexOf(op) * 48;
            const color =
              op.kind === "money"
                ? "#c5f879"
                : op.kind === "permission"
                  ? "#8dc9ff"
                  : "#a4aba3";
            return (
              <g
                key={op.position}
                opacity={active && active.position !== op.position ? 0.4 : 1}
              >
                <line
                  x1={x}
                  y1={wave(x)}
                  x2={x}
                  y2={wave(x, true)}
                  stroke={color}
                  strokeWidth={op.position === selected ? 8 : 4}
                />
                <circle cx={x} cy={wave(x)} r="5" fill={color} />
                <circle cx={x} cy={wave(x, true)} r="5" fill={color} />
              </g>
            );
          })}
        </svg>
      </div>
      <ol className="dna-ribbon" aria-label="Recorded operation sequence">
        {dna.operations.map((op, i) => (
          <li
            key={op.position}
            className={`dna-cell dna-${op.kind}`}
            title={`${i + 1}: ${op.label} · ${op.state}`}
          >
            <button
              type="button"
              onClick={() =>
                setSelected(op.position === selected ? "" : op.position)
              }
              aria-pressed={selected === op.position}
              aria-label={`DNA step ${i + 1}: ${op.label}`}
            >
              <span>{i + 1}</span>
              <b>
                {op.kind === "money"
                  ? "T"
                  : op.kind === "permission"
                    ? "P"
                    : "?"}
              </b>
            </button>
          </li>
        ))}
      </ol>
      {active && <DNAOperationDetails operation={active} />}
      <p className="small">
        T = decoded transfer · P = selected permission operation · ? =
        undecoded. Order follows X-Ray. {dna.operations.length} steps ·{" "}
        {dna.programs.length} resolved programs · Execution: {dna.execution}.
      </p>
      <p className="dna-hash">
        <strong>Evidence fingerprint / SHA-256</strong>
        <br />
        {dna.fingerprint}
      </p>
      {dna.gaps.length > 0 && (
        <details>
          <summary>Coverage notes · {dna.gaps.length}</summary>
          {dna.gaps.map((g) => (
            <p key={g}>{g}</p>
          ))}
        </details>
      )}
    </>
  );
}
export function TransactionDNAView({ model }: { model: XRayModel }) {
  const dna = useMemo(() => buildTransactionDNA(model), [model]);
  return (
    <section className="transaction-dna" data-testid="transaction-dna">
      <p className="eyebrow">TRANSACTION DNA / HISTORICAL STRUCTURE</p>
      <h3>See the transaction’s fingerprint.</h3>
      {dna ? (
        <>
          <DNAVisual dna={dna} />
          <details>
            <summary>Inspect DNA operations</summary>
            {dna.operations.map((op) => (
              <DNAOperationDetails key={op.position} operation={op} />
            ))}
          </details>
        </>
      ) : (
        <p>
          DNA unavailable: the recorded model is missing or outside supported
          limits.
        </p>
      )}
      <p className="small muted">
        Fingerprint v1 covers ordered X-Ray operations, amounts, permission
        targets, execution state, resolved programs and coverage notes.
        Undecoded steps retain raw instruction data and account references. It
        excludes signatures, fees and final balances. Matching DNA is not proof
        of identical transactions, current permissions or safety. Up to 200
        X-Ray steps; omissions remain disclosed.
      </p>
    </section>
  );
}
