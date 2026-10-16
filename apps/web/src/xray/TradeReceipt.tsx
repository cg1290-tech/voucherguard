import { useId, useMemo, useState } from "react";
import { displayUnits } from "../pro/transaction-insights";
import type { XRayModel } from "./model";
import { buildTradeReceipt, receiptOwners, receiptRate } from "./trade-receipt";
import "./trade.css";
export function TradeReceiptView({ model }: { model: XRayModel }) {
  const id = useId(),
    [selected, setSelected] = useState("");
  const owners = useMemo(() => receiptOwners(model), [model]);
  const owner = owners.includes(selected)
    ? selected
    : (owners.find((a) => a === model.walletImpact?.feePayer) ??
      owners[0] ??
      "");
  const receipt = useMemo(
    () => buildTradeReceipt(model, owner),
    [model, owner],
  );
  const rate = receipt ? receiptRate(receipt) : undefined;
  return (
    <section className="trade-receipt" data-testid="trade-receipt">
      <p className="eyebrow">TRADE RECEIPT / FREE</p>
      <h3>What left. What arrived.</h3>
      <label htmlFor={`${id}-owner`}>Receipt wallet / account</label>
      <select
        id={`${id}-owner`}
        value={owner}
        onChange={(e) => setSelected(e.target.value)}
      >
        {owners.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      {receipt ? (
        <>
          <p>
            Execution: {receipt.execution} · Slot:{" "}
            {receipt.slot ?? "Unavailable"}
          </p>
          <div className="trade-legs">
            {[false, true].map((received) => (
              <div key={String(received)}>
                <h4>
                  {received
                    ? "Received / net increases"
                    : "Sent / net decreases"}
                </h4>
                {receipt.balances
                  .filter((b) =>
                    received ? BigInt(b.change) > 0n : BigInt(b.change) < 0n,
                  )
                  .map((b) => (
                    <p key={b.asset}>
                      <strong>
                        {displayUnits(
                          (BigInt(b.change) < 0n
                            ? -BigInt(b.change)
                            : BigInt(b.change)
                          ).toString(),
                          b.decimals,
                        )}
                      </strong>
                      <br />
                      {b.asset}
                    </p>
                  ))}
              </div>
            ))}
          </div>
          <p>
            Recorded transaction network fee:{" "}
            {receipt.feeLamports === null
              ? "Unavailable"
              : `${displayUnits(receipt.feeLamports, 9)} SOL`}
            .{" "}
            {receipt.feePayer === owner
              ? "Already included in the wallet’s native SOL change; do not subtract it again."
              : "Paid by another account or ownership unavailable."}
          </p>
          <p>
            {receipt.candidate
              ? `Candidate ${receipt.candidate.side} against ${receipt.candidate.quoteSymbol}. Confirm its purpose in Pro before using it in a journal.`
              : "No simple trade established; these are historical balance changes."}
          </p>
          {rate !== undefined && receipt.candidate && (
            <p>
              Observed net exchange ratio: {displayUnits(rate, 9)}{" "}
              {receipt.candidate.quoteSymbol} per token (rounded down to 9
              decimals). This is a ratio of recorded net changes, not a market
              quote or slippage measurement.
            </p>
          )}
          {receipt.nativeSol && (
            <p>
              Native SOL reconciled: recorded/consolidated transfer cash flow{" "}
              {displayUnits(receipt.nativeSol.transferNetLamports, 9)} SOL;
              wallet change{" "}
              {displayUnits(receipt.nativeSol.observedNetLamports, 9)} SOL;
              {receipt.lifecycle && (
                <>
                  token-account capital change{" "}
                  {displayUnits(receipt.lifecycle.accountDeltaLamports, 9)} SOL;{" "}
                </>
              )}
              network fee {displayUnits(receipt.nativeSol.feeLamports, 9)} SOL.
              Journal allocates the fee once. Recorded tips or other native
              payments are included in cash flow, not classified as swap price.
            </p>
          )}
          {receipt.lifecycle && (
            <details data-testid="lifecycle-evidence">
              <summary>Proven account lifecycle & capital movements</summary>
              <p>
                Account funding:{" "}
                {displayUnits(receipt.lifecycle.fundingLamports, 9)} SOL. Gross
                closure refunds:{" "}
                {displayUnits(receipt.lifecycle.refundLamports, 9)} SOL. Refunds
                can contain both wrapped principal and account deposits; they
                are not all rent or trading income. Wallet plus owned
                token-account lamports reconcile with the external SOL/WSOL cash
                flow and network fee. No rent minimum is estimated.
              </p>
              {receipt.lifecycle.accounts.map((a) => (
                <p key={a.account}>
                  {a.account}
                  <br />
                  {a.created ? "Created" : "Existing"} ·{" "}
                  {a.closed ? "Closed" : "Retained"} · {a.mint}
                  <br />
                  Opening token amount / base units: {a.beforeAmount}{" "}
                  {a.zeroBeforeProven
                    ? "(zero proven by creation + initialization)"
                    : "(recorded)"}
                  . Closing token amount / base units: {a.afterAmount}{" "}
                  {a.zeroAfterProven
                    ? "(zero proven by closure)"
                    : "(recorded)"}
                  .
                </p>
              ))}
            </details>
          )}
          <details>
            <summary>Receipt scope & missing evidence</summary>
            {receipt.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </details>
        </>
      ) : (
        <p>
          Receipt unavailable: consistent before/after balances for this account
          are missing.
        </p>
      )}
      <p className="small muted">
        No price feed or extra RPC request. These are net changes, not
        guaranteed swap inputs/outputs, slippage or profit. Missing token
        boundaries use zero only when supported creation/initialization or
        closure evidence proves it. Other missing balances stay unknown. Open
        Trade Journal in Pro to connect confirmed trades.
      </p>
    </section>
  );
}
