import { useEffect, useId, useMemo, useState } from "react";
import { displayUnits } from "../pro/transaction-insights";
import type { RuleReport } from "../pro/transaction-rules";
import type { XRayModel } from "./model";
import { PermissionMap } from "./PermissionMap";
import { stepFlagged as flagged } from "./permission-map";
import { WalletImpactView } from "./WalletImpact";
import { focusAccounts, involvesAccount } from "./wallet-focus";
import "./xray.css";

const short = (s: string) =>
  s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-5)}` : s;
export function TransactionXRay({
  model,
  rules,
  autoPlay = false,
}: {
  model: XRayModel;
  rules?: RuleReport | undefined;
  autoPlay?: boolean;
}) {
  const focusId = useId();
  const [focus, setFocus] = useState("");
  const accounts = focusAccounts(model);
  const steps = useMemo(
    () =>
      focus
        ? model.steps.filter((s) => involvesAccount(s, focus))
        : model.steps,
    [model, focus],
  );
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"money" | "permission">("money");
  const [playing, setPlaying] = useState(
    () =>
      autoPlay &&
      !document.hidden &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (!playing || !steps.length) return;
    const timer = setInterval(
      () =>
        setIndex((i) => {
          if (i >= steps.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1300,
    );
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [playing, steps.length]);
  useEffect(() => {
    const active = steps[index];
    if (playing && active?.kind !== "unknown" && active) setView(active.kind);
  }, [index, playing, steps]);
  const step = steps[index];
  const isFlagged = step ? flagged(step, rules) : false;
  const visibleFlow = step?.kind === view && !!step.from;
  const outcome =
    model.execution === "succeeded"
      ? "Recorded in successful execution"
      : model.execution === "failed"
        ? model.failure?.instructionIndex !== undefined &&
          step?.instructionIndex !== undefined &&
          step.instructionIndex > model.failure.instructionIndex
          ? "Not reached · transaction stopped earlier"
          : "Attempted only · transaction failed"
        : "Execution not established";
  return (
    <section
      className="xray"
      data-testid="transaction-xray"
      aria-label="Transaction X-Ray"
    >
      <WalletImpactView model={model} rules={rules} />
      <PermissionMap model={model} rules={rules} />
      <div className="xray-heading">
        <div>
          <p className="eyebrow">TRANSACTION X-RAY / HISTORICAL EVIDENCE</p>
          <h3>Look inside the transaction.</h3>
        </div>
        <span className="xray-outcome">
          {model.execution === "succeeded"
            ? "Successful execution"
            : model.execution === "failed"
              ? "Failed execution: attempts only"
              : "Execution unknown"}
        </span>
      </div>
      <p>
        Play the recorded instructions. Switch lenses to see decoded transfers
        or selected account permissions.
      </p>
      {model.failure && (
        <div className="xray-failure" data-testid="failure-explanation">
          <p className="eyebrow">WHY DID IT FAIL?</p>
          <h4>
            {model.failure.instructionIndex !== undefined
              ? `Failure reported at instruction ${model.failure.instructionIndex + 1}`
              : "Failure point unavailable"}
          </h4>
          <p>{model.failure.explanation}</p>
          <p>Error: {model.failure.code}</p>
          <p>
            Recorded network fee:{" "}
            {model.insights.feeLamports !== undefined
              ? `${displayUnits(model.insights.feeLamports, 9)} SOL`
              : "Unavailable"}
            . The transaction failed; decoded transfers and permission changes
            must not be treated as applied.
          </p>
          {model.failure.instructionIndex !== undefined && (
            <button
              type="button"
              disabled={
                !model.steps.some(
                  (s) =>
                    s.position ===
                    `Instruction ${(model.failure?.instructionIndex ?? 0) + 1}`,
                )
              }
              onClick={() => {
                const i = model.steps.findIndex(
                  (s) =>
                    s.position ===
                    `Instruction ${(model.failure?.instructionIndex ?? 0) + 1}`,
                );
                if (i < 0) return;
                setFocus("");
                setIndex(i);
                setPlaying(false);
                setDetails(true);
                setView(
                  model.steps[i]?.kind === "permission"
                    ? "permission"
                    : "money",
                );
              }}
            >
              Show failure point
            </button>
          )}
          <p className="small muted">
            The error identifies a top-level instruction; a nested call may be
            the source. Pro preference alerts are separate checks, not a
            diagnosis of the failure.
          </p>
          <details>
            <summary>Recorded logs & error evidence</summary>
            <p>
              Program-written diagnostic text is shown as evidence, not a
              verified explanation.
            </p>
            <pre className="xray-logs">
              {model.failure.logs.length
                ? model.failure.logs.join("\n")
                : "No recorded logs available."}
            </pre>
            {model.failure.logsIncomplete && (
              <p>
                Logs unavailable, malformed or shortened. Display is limited to
                the last 80 lines, 512 characters per line and 12,000 characters
                total.
              </p>
            )}
          </details>
        </div>
      )}
      <div className="xray-focus">
        <label htmlFor={focusId}>My wallet / account</label>
        <select
          id={focusId}
          value={focus}
          onChange={(e) => {
            setPlaying(false);
            setIndex(0);
            setDetails(false);
            setFocus(e.target.value);
            const first = model.steps.find(
              (s) => !e.target.value || involvesAccount(s, e.target.value),
            );
            setView(first?.kind === "permission" ? "permission" : "money");
          }}
        >
          <option value="">Whole transaction</option>
          {accounts.map((account) => (
            <option key={account} value={account}>
              {account}
            </option>
          ))}
        </select>
        <p className="small muted">
          Choose an address already present. Only direct account references are
          matched; token-account ownership is not inferred. No wallet connection
          needed.
        </p>
        {focus && (
          <p role="status">
            {steps.length} of {model.steps.length} recorded steps reference this
            account. {steps.filter((s) => s.kind === "money").length} decoded
            transfers · {steps.filter((s) => s.kind === "permission").length}{" "}
            selected permission operations ·{" "}
            {steps.filter((s) => s.kind === "unknown").length} undecoded steps.
          </p>
        )}
      </div>
      <div className="xray-controls">
        <button
          type="button"
          aria-pressed={view === "money"}
          onClick={() => {
            setPlaying(false);
            setView("money");
          }}
        >
          Money
        </button>
        <button
          type="button"
          aria-pressed={view === "permission"}
          onClick={() => {
            setPlaying(false);
            setView("permission");
          }}
        >
          Permissions
        </button>
        <button
          type="button"
          disabled={!steps.length}
          onClick={() => {
            if (index >= steps.length - 1) setIndex(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause X-Ray" : "Play X-Ray"}
        </button>
        <button
          type="button"
          disabled={!index}
          onClick={() => {
            setPlaying(false);
            setIndex(index - 1);
          }}
        >
          Previous step
        </button>
        <button
          type="button"
          disabled={index >= steps.length - 1}
          onClick={() => {
            setPlaying(false);
            setIndex(index + 1);
          }}
        >
          Next step
        </button>
      </div>
      {rules && (
        <p className="xray-rule-note">
          Pro preferences ·{" "}
          {rules.status === "flagged"
            ? "Flagged"
            : rules.status === "incomplete"
              ? "Incomplete"
              : rules.status === "within-rule"
                ? "Within checked rules"
                : "No rules enabled"}
          . {rules.checks.find((c) => c.name === "Network fee")?.explanation}{" "}
          Highlighted instructions match your saved alerts or are outside your
          allowed program list. Incomplete checks remain incomplete.
        </p>
      )}
      {step ? (
        <>
          <div
            className={`xray-stage ${visibleFlow && step.kind === "permission" ? "xray-permission-flow" : ""} ${playing && model.execution === "succeeded" ? "xray-running" : ""} ${isFlagged ? "xray-flagged" : ""} ${model.failure?.instructionIndex !== undefined && step.instructionIndex === model.failure.instructionIndex && step.position.startsWith("Instruction ") ? "xray-failed-step" : ""}`}
          >
            <p className="xray-position">
              {index + 1} / {steps.length} · {step.position} · {outcome}
              {isFlagged ? " · YOUR RULE FLAGGED THIS STEP" : ""}
              {model.failure?.instructionIndex !== undefined &&
              step.instructionIndex === model.failure.instructionIndex &&
              step.position.startsWith("Instruction ")
                ? " · FAILURE REPORTED HERE"
                : ""}
            </p>
            <h4>{step.label}</h4>
            {focus && (
              <p className="xray-focus-role">
                {step.from === focus && step.to === focus
                  ? "Selected account is both endpoints"
                  : step.from === focus
                    ? "From selected account"
                    : step.to === focus
                      ? "To selected account"
                      : "Selected account referenced · role not established"}
              </p>
            )}
            <button
              className="xray-diagram"
              type="button"
              onClick={() => setDetails(!details)}
              aria-label="Inspect current instruction"
            >
              <span
                className={`xray-node ${visibleFlow && step.from === focus ? "xray-focus-node" : ""}`}
              >
                <small>
                  {visibleFlow ? "Source account" : "Referenced program"}
                </small>
                <strong>
                  {short(
                    visibleFlow
                      ? (step.from ?? "Unknown")
                      : step.program || "Unresolved",
                  )}
                </strong>
              </span>
              <svg
                viewBox="0 0 200 60"
                role="img"
                aria-label={
                  visibleFlow
                    ? "Decoded instruction relationship"
                    : "Operation not decoded in this lens"
                }
              >
                <path
                  className={
                    !visibleFlow
                      ? "xray-unknown"
                      : model.execution === "succeeded"
                        ? "xray-edge"
                        : "xray-attempt"
                  }
                  d="M 5 30 L 190 30"
                />
                <path className="xray-arrow" d="M 175 20 L 190 30 L 175 40" />
              </svg>
              <span
                className={`xray-node ${visibleFlow && step.to === focus ? "xray-focus-node" : ""}`}
              >
                <small>
                  {visibleFlow
                    ? step.kind === "money"
                      ? "Destination account"
                      : "Permission endpoint"
                    : "Coverage"}
                </small>
                <strong>
                  {visibleFlow
                    ? short(step.to ?? "Account operation")
                    : step.kind === "unknown"
                      ? "Not decoded"
                      : "Switch lens"}
                </strong>
              </span>
            </button>
            {visibleFlow && step.amount !== undefined && (
              <p className="xray-amount">
                {step.decimals !== undefined
                  ? displayUnits(step.amount, step.decimals)
                  : `${step.amount} base units`}{" "}
                {step.asset === "SOL" ? "SOL" : "tokens"}
                <span>
                  {model.execution === "failed"
                    ? "Requested amount · not applied"
                    : "Recorded instruction amount"}
                </span>
              </p>
            )}
            <p>{step.details}</p>
            {details && (
              <div className="xray-evidence">
                <p>Program: {step.program || "Unresolved"}</p>
                {step.from && <p>Source account: {step.from}</p>}
                {step.to && <p>Endpoint: {step.to}</p>}
                {step.asset && <p>Asset: {step.asset}</p>}
                {step.instructionData && (
                  <p className="xray-raw">
                    Instruction bytes / base58: {step.instructionData}
                  </p>
                )}
                {step.accountAddresses && (
                  <p className="xray-raw">
                    Instruction accounts: {step.accountAddresses.join(", ")}
                  </p>
                )}
                <p>{outcome}. No intermediate balances are simulated.</p>
              </div>
            )}
          </div>
          <label className="xray-scrub">
            Recorded step{" "}
            <input
              type="range"
              min="0"
              max={steps.length - 1}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
          </label>
          <div className="xray-steps">
            {steps.map((s, i) => (
              <button
                type="button"
                key={s.id}
                className={`${i === index ? "xray-selected" : ""} ${flagged(s, rules) ? "xray-alert" : ""}`}
                onClick={() => {
                  setPlaying(false);
                  setIndex(i);
                  setView(s.kind === "permission" ? "permission" : "money");
                  setDetails(true);
                }}
              >
                {i + 1} · {s.label}
                {flagged(s, rules) ? " · Flagged" : ""}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p>
          {focus
            ? "No recorded steps reference this account. This does not prove no effects or permissions."
            : "No recorded instruction steps available."}
        </p>
      )}
      <details>
        <summary>Network fee, net balance changes & coverage</summary>
        <p>
          Network fee:{" "}
          {model.execution !== "unknown" &&
          model.insights.feeLamports !== undefined
            ? `${displayUnits(model.insights.feeLamports, 9)} SOL`
            : "Unavailable"}
        </p>
        <p>
          These are final net account changes, not profit/loss or intermediate
          balances.
        </p>
        {model.execution !== "unknown" &&
          model.insights.balanceChanges
            .filter((c) => !focus || c.account === focus)
            .map((c) => (
              <p key={`${c.account}-${c.asset}`}>
                {short(c.account)} · {displayUnits(c.change, c.decimals)}{" "}
                {c.asset === "SOL" ? "SOL" : "tokens"} · {c.asset}
              </p>
            ))}
        {[...model.gaps, ...model.insights.coverage].map((g) => (
          <p key={g}>{g}</p>
        ))}
      </details>
      <p className="small muted">
        Animation follows recorded instruction order, not real execution timing.
        Gray steps are not decoded. This does not check current permissions,
        program reputation or future safety. No extra RPC request is made by
        playback.
      </p>
      {!rules && <a href="#pro">Apply your personal rules with Pro →</a>}
    </section>
  );
}
