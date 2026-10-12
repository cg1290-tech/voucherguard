import {
  displayUnits,
  type TransactionInsights as Insights,
} from "./transaction-insights";
export function TransactionInsights({ insights }: { insights: Insights }) {
  const highlighted = insights.permissionEvents.filter(
    (e) => e.action !== "Delegation revocation",
  );
  return (
    <section
      className="pro-insights"
      data-testid="pro-insights"
      aria-label="Additional Pro checks"
    >
      <p className="eyebrow">PRO / TRANSACTION EFFECTS</p>
      <h3>
        {!insights.success
          ? "Failed execution — review attempted effects"
          : highlighted.length
            ? `${highlighted.length} operation${highlighted.length === 1 ? "" : "s"} to inspect`
            : "Recorded effects, explained"}
      </h3>
      <dl className="pro-link-facts">
        <div>
          <dt>Network fee</dt>
          <dd>
            {insights.feeLamports !== undefined
              ? `${displayUnits(insights.feeLamports, 9)} SOL`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Fee-payer net SOL change</dt>
          <dd>
            {insights.feePayerNetLamports !== undefined
              ? `${displayUnits(insights.feePayerNetLamports, 9)} SOL`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt>Programs referenced</dt>
          <dd>{insights.programs.length}</dd>
        </div>
        <div>
          <dt>Recorded inner instructions</dt>
          <dd>{insights.innerInstructionCount}</dd>
        </div>
      </dl>
      <p className="small muted">
        SOL changes include fees, rent and transfers. They are net account
        changes, not reconstructed payments or your personal profit/loss.
      </p>
      {insights.warnings.map((w) => (
        <p className="insight-warning" key={w}>
          {w}
        </p>
      ))}
      <h4>Permissions & account operations</h4>
      {!insights.permissionEvents.length ? (
        <p>
          No highlighted operation was decoded. Check coverage below; this is
          not proof that the transaction grants no permissions.
        </p>
      ) : (
        insights.permissionEvents.map((e) => (
          <article
            className="insight-operation"
            key={`${e.position}-${e.action}`}
          >
            <strong>
              {e.action} ·{" "}
              {e.applied
                ? "transaction succeeded"
                : "attempted; transaction failed"}
            </strong>
            <p>{e.details}</p>
            <p className="small muted">
              {e.position} · Account {e.account}
            </p>
          </article>
        ))
      )}
      <h4>Balance changes</h4>
      {!insights.balanceChanges.length ? (
        <p>
          {insights.solBalancesComplete && insights.tokenBalancesComplete
            ? "No net changes in the supplied balance snapshots."
            : "No exact balance changes available from the supplied metadata."}
        </p>
      ) : (
        <div className="insight-balances">
          {insights.balanceChanges.map((c) => (
            <div key={`${c.account}-${c.asset}`}>
              <strong>
                {BigInt(c.change) > 0n ? "+" : ""}
                {displayUnits(c.change, c.decimals)}{" "}
                {c.asset === "SOL" ? "SOL" : "tokens"}
              </strong>
              <p className="small muted">
                Account: {c.account}
                {c.asset !== "SOL" && (
                  <>
                    <br />
                    Mint: {c.asset}
                  </>
                )}
                {c.owner && (
                  <>
                    <br />
                    Owner: {c.owner}
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary>What do these checks mean?</summary>
        <p>
          Delegation: an instruction authorizes a delegate to spend a specified
          token amount. This report records that instruction; it does not
          confirm that the permission is still active.
        </p>
        <p>
          Authority change: control over a token account or mint may move to
          another address. Check the operation details to understand which
          authority changed.
        </p>
        <p>
          Freeze: an instruction can restrict transfers from a token account.
          Burn removes tokens; close removes an account and returns its rent
          balance.
        </p>
        <p>
          Failed execution: instruction effects were not applied, although the
          network fee may still have been charged. Missing coverage means a
          check could not be completed, not that it passed.
        </p>
      </details>
      <details>
        <summary>Programs, fee payer & coverage</summary>
        <p className="small muted">
          Fee payer: {insights.feePayer ?? "Unavailable"}
        </p>
        <ul>
          {insights.programs.map((p) => (
            <li key={p}>
              <a
                href={`https://solscan.io/account/${p}`}
                target="_blank"
                rel="noreferrer"
              >
                {p}
              </a>
            </li>
          ))}
        </ul>
        {insights.coverage.map((c) => (
          <p key={c}>{c}</p>
        ))}
        <p>
          All findings describe this historical transaction. No live permission
          check or program audit was performed.
        </p>
      </details>
    </section>
  );
}
