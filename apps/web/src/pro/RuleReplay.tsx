import { serializeReport } from "@voucherguard/core";
import { useId, useState } from "react";
import { PermissionMap } from "../xray/PermissionMap";
import { RuleResults } from "./TransactionRules";
import type { TransactionReview } from "./transaction-review";
import {
  evaluateRules,
  type RuleReport,
  type TransactionRules,
} from "./transaction-rules";
import "./rule-replay.css";

export function replayProfiles(custom: TransactionRules) {
  return {
    Custom: structuredClone(custom),
    Balanced: {
      ...structuredClone(custom),
      maxFeeSol: "0.001",
      flagDelegations: true,
      flagAuthorityChanges: true,
      maxSolDecrease: "",
      flagTokenDecreases: false,
    },
    Strict: {
      ...structuredClone(custom),
      maxFeeSol: "0.0001",
      flagDelegations: true,
      flagAuthorityChanges: true,
      maxSolDecrease: "0.1",
      flagTokenDecreases: true,
    },
  };
}
export function RuleReplay({
  review,
  owner,
  captured,
}: {
  review: TransactionReview;
  owner: string;
  captured: RuleReport;
}) {
  const id = useId();
  const [profiles, setProfiles] = useState(() =>
    replayProfiles(captured.rules),
  );
  const [selected, setSelected] = useState<keyof typeof profiles>("Custom");
  const reports = Object.fromEntries(
    Object.entries(profiles).map(([name, rules]) => [
      name,
      evaluateRules(review.insights, rules, review.xray?.walletImpact, owner),
    ]),
  );
  const active = reports[selected] as RuleReport;
  const baseline = reports.Custom as RuleReport;
  function update(patch: Partial<TransactionRules>) {
    setProfiles({
      ...profiles,
      [selected]: { ...profiles[selected], ...patch },
    });
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          serializeReport({
            version: 1,
            mode: "historical-rule-replay",
            signature: review.signature,
            owner,
            exportedAt: new Date().toISOString(),
            captured,
            profiles: reports,
            insights: review.insights,
            xray: review.xray,
            limitations:
              "Temporary preference comparison on loaded historical evidence. No transaction simulation, safety verdict or current permission check.",
          }),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "voucherguard-rule-replay.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="rule-replay" data-testid="rule-replay">
      <p className="eyebrow">RULE REPLAY / PRO</p>
      <h3>Same transaction. Different guardrails.</h3>
      <p>
        Compare temporary profiles using evidence already loaded. Balanced flags
        selected permission changes with a 0.001 SOL fee cap. Strict adds a
        0.0001 SOL fee cap, a 0.1 SOL net decrease cap and token decrease
        alerts. Both retain your captured program and token lists. These are
        editable examples, not safety ratings.
      </p>
      <div className="replay-profiles">
        {Object.entries(reports).map(([name, report]) => (
          <button
            type="button"
            key={name}
            aria-pressed={selected === name}
            onClick={() => setSelected(name as keyof typeof profiles)}
          >
            <strong>{name}</strong>
            <span>{report.status.replaceAll("-", " ")}</span>
            <span>
              {report.checks.filter((c) => c.status === "flagged").length}{" "}
              flagged ·{" "}
              {report.checks.filter((c) => c.status === "incomplete").length}{" "}
              incomplete
            </span>
          </button>
        ))}
      </div>
      <fieldset>
        <legend>Adjust {selected} for this replay</legend>
        <label htmlFor={`${id}-fee`}>Network fee cap / SOL</label>
        <select
          id={`${id}-fee`}
          value={profiles[selected].maxFeeSol}
          onChange={(e) => update({ maxFeeSol: e.target.value })}
        >
          {[
            ...new Set([
              "",
              "0.0001",
              "0.001",
              "0.01",
              profiles[selected].maxFeeSol,
            ]),
          ].map((v) => (
            <option key={v} value={v}>
              {v || "Off"}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-sol`}>My wallet net SOL decrease cap</label>
        <select
          id={`${id}-sol`}
          value={profiles[selected].maxSolDecrease ?? ""}
          onChange={(e) => update({ maxSolDecrease: e.target.value })}
        >
          {[
            ...new Set([
              "",
              "0.1",
              "1",
              "10",
              profiles[selected].maxSolDecrease ?? "",
            ]),
          ].map((v) => (
            <option key={v} value={v}>
              {v || "Off"}
            </option>
          ))}
        </select>
        {(
          [
            ["flagDelegations", "Flag spending delegations"],
            ["flagAuthorityChanges", "Flag authority changes"],
            ["flagTokenDecreases", "Flag my wallet token decreases"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={profiles[selected][key] ?? false}
              onChange={(e) => update({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="replay-table-scroll">
        <table>
          <caption>Rule-by-rule comparison</caption>
          <thead>
            <tr>
              <th>Check</th>
              {Object.keys(reports).map((n) => (
                <th key={n}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ...new Set(
                Object.values(reports).flatMap((r) =>
                  r.checks.map((c) => c.name),
                ),
              ),
            ].map((name) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                {Object.entries(reports).map(([profile, r]) => (
                  <td key={profile}>
                    {r.checks
                      .find((c) => c.name === name)
                      ?.status.replaceAll("-", " ") ?? "Off"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p role="status">
        {
          active.checks.filter(
            (c) =>
              baseline.checks.find((b) => b.name === c.name)?.status !==
              c.status,
          ).length
        }{" "}
        enabled check outcomes differ from the current Custom profile.
      </p>
      <RuleResults report={active} replay />
      {review.xray && <PermissionMap model={review.xray} rules={active} />}
      <div className="pro-link-actions">
        <button
          type="button"
          onClick={() => setProfiles(replayProfiles(captured.rules))}
        >
          Reset replay profiles
        </button>
        <button type="button" onClick={download}>
          Export replay comparison
        </button>
      </div>
      <p className="small muted">
        Replay changes stay in this panel. Saved preferences and the original
        captured report remain unchanged. Wallet checks apply to your
        authenticated address. Incomplete evidence stays incomplete. Permission
        Map highlights only matching decoded permission and program-list
        operations; fee and balance checks remain in the report.
      </p>
    </section>
  );
}
