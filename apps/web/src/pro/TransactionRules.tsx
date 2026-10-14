import { useState } from "react";
import {
  type RuleReport,
  type TransactionRules,
  validateRules,
} from "./transaction-rules";
export function RulePreferences({
  rules,
  saved,
  busy,
  programs,
  assets,
  notice,
  onSave,
}: {
  rules: TransactionRules;
  saved: boolean;
  busy: boolean;
  programs: string[];
  assets: string[];
  notice: string;
  onSave: (rules: TransactionRules) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(rules));
  const [list, setList] = useState(rules.allowedPrograms.join("\n"));
  const [assetList, setAssetList] = useState(
    (rules.allowedAssets ?? []).join("\n"),
  );
  const [error, setError] = useState("");
  function save() {
    try {
      const next = validateRules({
        ...draft,
        allowedAssets: assetList.split(/\s+/).filter(Boolean),
        allowedPrograms: list.split(/\s+/).filter(Boolean),
      });
      onSave(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save preferences.");
    }
  }
  const count =
    Number(rules.restrictAssets) +
    Number(!!rules.maxSolDecrease) +
    Number(rules.flagTokenDecreases) +
    Number(!!rules.maxFeeSol) +
    Number(rules.flagDelegations) +
    Number(rules.flagAuthorityChanges) +
    Number(rules.restrictPrograms);
  return (
    <>
      <details className="pro-rule-preferences">
        <summary>
          My transaction rules · {count} active ·{" "}
          {saved ? "saved on this device" : "this visit"}
        </summary>
        <p>
          Set once, then paste a link. These checks use the transaction already
          loaded; no extra RPC requests.
        </p>
        <fieldset disabled={busy}>
          <p>
            Wallet Impact guardrails apply to your authenticated wallet. Net
            decreases can reflect transfers, swaps, fees or account operations;
            they are not profit/loss.
          </p>
          <label htmlFor="rule-sol-decrease">
            Maximum net SOL decrease (optional)
          </label>
          <input
            id="rule-sol-decrease"
            inputMode="decimal"
            maxLength={22}
            placeholder="e.g. 0.1"
            value={draft.maxSolDecrease ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, maxSolDecrease: e.target.value })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={draft.flagTokenDecreases ?? false}
              onChange={(e) =>
                setDraft({ ...draft, flagTokenDecreases: e.target.checked })
              }
            />{" "}
            Flag net token decreases in my wallet
          </label>
          <label htmlFor="rule-max-fee">
            Maximum network fee / SOL (optional)
          </label>
          <input
            id="rule-max-fee"
            inputMode="decimal"
            maxLength={22}
            placeholder="e.g. 0.001"
            value={draft.maxFeeSol}
            onChange={(e) => setDraft({ ...draft, maxFeeSol: e.target.value })}
          />
          <label>
            <input
              type="checkbox"
              checked={draft.flagDelegations}
              onChange={(e) =>
                setDraft({ ...draft, flagDelegations: e.target.checked })
              }
            />{" "}
            Flag spending delegations
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.flagAuthorityChanges}
              onChange={(e) =>
                setDraft({ ...draft, flagAuthorityChanges: e.target.checked })
              }
            />{" "}
            Flag authority changes
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.restrictPrograms}
              onChange={(e) =>
                setDraft({ ...draft, restrictPrograms: e.target.checked })
              }
            />{" "}
            Only allow my saved programs
          </label>
          {draft.restrictPrograms && (
            <>
              <label htmlFor="rule-programs">Allowed program addresses</label>
              <textarea
                id="rule-programs"
                rows={3}
                value={list}
                maxLength={6000}
                onChange={(e) => setList(e.target.value)}
              />
              <p className="small muted">
                Up to 64 program addresses. Saving an address expresses your
                preference; it does not establish that the program is safe.
              </p>
            </>
          )}
          <label>
            <input
              type="checkbox"
              checked={draft.restrictAssets ?? false}
              onChange={(e) =>
                setDraft({ ...draft, restrictAssets: e.target.checked })
              }
            />{" "}
            Flag balance changes on tokens outside my saved list
          </label>
          {draft.restrictAssets && (
            <>
              <label htmlFor="rule-assets">Allowed token mint addresses</label>
              <textarea
                id="rule-assets"
                rows={3}
                maxLength={6000}
                value={assetList}
                onChange={(e) => setAssetList(e.target.value)}
              />
              <p className="small muted">
                Up to 64 mint addresses. This is your personal preference list;
                it does not certify token safety. Applies to nonzero recorded
                net changes in your authenticated wallet.
              </p>
            </>
          )}
          <div className="pro-link-actions">
            <button type="button" onClick={save}>
              Save transaction preferences
            </button>
            <button
              type="button"
              disabled={!programs.length}
              onClick={() => {
                setList([...new Set(programs)].join("\n"));
                setDraft({ ...draft, restrictPrograms: true });
              }}
            >
              Use programs from current reviews
            </button>
            <button
              type="button"
              disabled={!assets.length}
              onClick={() => {
                setAssetList([...new Set(assets)].slice(0, 64).join("\n"));
                setDraft({ ...draft, restrictAssets: true });
              }}
            >
              Use tokens from my current reviews
            </button>
          </div>
          <p className="small muted">
            The import buttons replace their draft lists; the token button uses
            the first 64 distinct mints with documented ownership in your
            current reviews. Review it and save to apply. New preferences apply
            to your next review; existing reports retain the rules used when
            generated.
          </p>
        </fieldset>
        {error && <p role="alert">{error}</p>}

        <p className="small muted">
          Stored locally for this wallet. No sync between devices. Clearing
          browser data removes these preferences.
        </p>
      </details>
      {notice && (
        <p role="status" className="pro-notice">
          {notice}
        </p>
      )}
    </>
  );
}
export function RuleResults({
  report,
  replay = false,
}: {
  report: RuleReport;
  replay?: boolean;
}) {
  return (
    <section
      className="pro-rule-results"
      data-testid={replay ? "replay-rule-results" : "transaction-rule-results"}
    >
      <p className="eyebrow">
        {replay ? "TEMPORARY REPLAY RULES" : "YOUR TRANSACTION RULES"}
      </p>
      <h3>
        {report.status === "flagged"
          ? "Your rules flagged this transaction"
          : report.status === "incomplete"
            ? "Some rule checks are incomplete"
            : report.status === "not-configured"
              ? "No transaction rules enabled"
              : "Within your checked rules"}
      </h3>
      {report.checks.map((c) => (
        <div key={c.name}>
          <strong>
            {c.name} ·{" "}
            {c.status === "within-rule"
              ? "Within rule"
              : c.status === "flagged"
                ? "Flagged"
                : "Incomplete"}
          </strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.explanation}</p>
        </div>
      ))}
      <p className="small muted">
        Historical evidence checked against your captured preferences. This does
        not block an on-chain transaction, certify safety or check live
        permissions. Failed execution may still contain attempted operations.
      </p>
    </section>
  );
}
