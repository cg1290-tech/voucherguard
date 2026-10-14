import { useId, useState } from "react";
import { displayUnits } from "../pro/transaction-insights";
import type { RuleReport } from "../pro/transaction-rules";
import type { XRayModel } from "./model";
export function WalletImpactView({
  model,
  rules,
}: {
  model: XRayModel;
  rules?: RuleReport | undefined;
}) {
  const data = model.walletImpact;
  const id = useId();
  const [selected, setSelected] = useState("");
  if (!data) return null;
  const address = selected || data.feePayer || data.wallets[0]?.address || "";
  const wallet = data.wallets.find((w) => w.address === address);
  const accounts = new Set([address, ...(wallet?.tokenAccounts ?? [])]);
  const permissions = model.steps.filter(
    (s) =>
      s.kind === "permission" &&
      s.accountAddresses?.some((a) => accounts.has(a)),
  );
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            scope:
              "Historical wallet impact; recorded balances only, no current holdings or profit/loss",
            signature: data?.signature,
            execution: data?.execution,
            wallet,
            feeLamports: data?.feeLamports,
            feePayer: data?.feePayer,
            permissions,
            transactionRules: rules,
            coverage: data?.gaps,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "voucherguard-wallet-impact.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section
      className="xray-impact"
      data-testid="wallet-impact"
      aria-label="Wallet Impact"
    >
      <p className="eyebrow">WALLET IMPACT / HISTORICAL SNAPSHOT</p>
      <h3>What actually changed?</h3>
      <label htmlFor={id}>Wallet / account to summarize</label>
      <select
        id={id}
        value={address}
        onChange={(e) => setSelected(e.target.value)}
      >
        {data.wallets.map((w) => (
          <option key={w.address} value={w.address}>
            {w.address}
          </option>
        ))}
      </select>
      <p>
        Token accounts are grouped only when the recorded owner, asset and
        precision agree before and after. Other addresses are account views, not
        verified personal wallets.
      </p>
      {data.execution === "unknown" ? (
        <p>Execution unknown. Balance impact is not established.</p>
      ) : (
        <>
          {data.execution === "failed" && (
            <p>
              Transaction failed. These are recorded final balances, not
              completed transfers. Fees may still be charged.
            </p>
          )}
          <div className="xray-impact-balances">
            {wallet?.balances.map((c) => (
              <div
                className="xray-impact-card"
                key={`${c.asset}-${c.decimals}`}
              >
                <strong>{c.asset === "SOL" ? "SOL" : "Token"}</strong>
                {c.asset !== "SOL" && (
                  <p className="xray-raw">Mint: {c.asset}</p>
                )}
                <p>
                  {displayUnits(c.before, c.decimals)} <span>→</span>{" "}
                  {displayUnits(c.after, c.decimals)}
                </p>
                <strong>
                  {BigInt(c.change) > 0n ? "+" : ""}
                  {displayUnits(c.change, c.decimals)} net change
                </strong>
                <p className="small muted">
                  {c.accounts.length} recorded account
                  {c.accounts.length === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
          {!wallet?.balances.length && (
            <p>No supported balance totals available for this address.</p>
          )}
        </>
      )}
      <p>
        Recorded network fee:{" "}
        {data.feeLamports !== undefined && data.execution !== "unknown"
          ? `${displayUnits(data.feeLamports, 9)} SOL`
          : "Unavailable"}
        .{" "}
        {data.execution !== "unknown" && data.feePayer === address
          ? "Selected account paid the fee; it is already included in its net SOL change."
          : `Fee payer: ${data.feePayer || "Unavailable"}`}
      </p>
      <details>
        <summary>
          Selected permission operations referencing these accounts (
          {permissions.length})
        </summary>
        {permissions.map((s) => (
          <p key={s.id}>
            {s.position} · {s.permissionAction} ·{" "}
            {data.execution === "succeeded"
              ? "Recorded in successful execution"
              : "Not established as applied"}
          </p>
        ))}
        <p>
          References may identify an authority or endpoint, not necessarily a
          permission granted to this wallet. This does not check current
          permissions.
        </p>
      </details>
      {rules && (
        <div className="xray-rule-note">
          <p>
            Pro transaction rules: {rules.status}. Captured checks include
            transaction-wide rules and guardrails for the authenticated wallet.
            Selecting an address does not change their scope.
          </p>
          {rules.checks.map((c) => (
            <p key={c.name}>
              {c.name}: {c.explanation}
            </p>
          ))}
          <button type="button" onClick={download}>
            Export Wallet Impact
          </button>
        </div>
      )}
      <details>
        <summary>Coverage & limitations</summary>
        {data.gaps.map((g) => (
          <p key={g}>{g}</p>
        ))}
        <p>
          Totals cover only supplied account snapshots. Missing records and
          accounts with changed ownership are excluded. No current holdings,
          prices, profit/loss or safety verdict. SOL changes can include fees,
          rent and account operations; do not subtract the fee again.
        </p>
      </details>
    </section>
  );
}
