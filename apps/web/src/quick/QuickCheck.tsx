import { useState, type FormEvent } from "react";
import {
  type HistoricalTxReport,
  type QuickExtractResult,
  quickCheckTransaction,
} from "./extract";

const DEFAULT_RPC =
  import.meta.env.VITE_VG_RPC_URL?.trim() ||
  "https://voucherguard.pages.dev/api/solana-rpc";

function HistoricalView({ result }: { result: HistoricalTxReport }) {
  const crypto = result.voucherReport;
  return (
    <div className="quick-report" data-testid="quick-report">
      <p className="eyebrow">VOUCHERGUARD — TRANSACTION REPORT</p>
      <table className="quick-table">
        <tbody>
          <tr>
            <th scope="row">Network</th>
            <td>Solana Mainnet</td>
          </tr>
          <tr>
            <th scope="row">Transaction</th>
            <td>{result.success ? "Confirmed" : "Failed on-chain"}</td>
          </tr>
          <tr>
            <th scope="row">Protocol</th>
            <td>Solana Payment Channels V1</td>
          </tr>
          <tr>
            <th scope="row">Settlement</th>
            <td>
              {result.settlement === "settle" ? "settle" : "settle_and_seal"}
            </td>
          </tr>
          <tr>
            <th scope="row">Channel</th>
            <td className="mono">{result.channelId}</td>
          </tr>
          <tr>
            <th scope="row">Authorized signer</th>
            <td className="mono">{result.authorizedSigner}</td>
          </tr>
          <tr>
            <th scope="row">Cumulative amount</th>
            <td>{result.cumulativeAmount}</td>
          </tr>
          <tr>
            <th scope="row">Expires at</th>
            <td>{result.expiresAt}</td>
          </tr>
          <tr>
            <th scope="row">Signed message</th>
            <td>Extracted</td>
          </tr>
          <tr>
            <th scope="row">Ed25519 signature</th>
            <td>{crypto.status === "PASS" ? "Valid" : crypto.status}</td>
          </tr>
          <tr>
            <th scope="row">Slot</th>
            <td>{result.slot}</td>
          </tr>
          <tr>
            <th scope="row">Additional policy checks</th>
            <td>Not evaluated</td>
          </tr>
        </tbody>
      </table>
      <p
        className={`quick-verdict ${crypto.status === "PASS" && result.success ? "pass" : "warn"}`}
        role="status"
      >
        {crypto.status === "PASS" && result.success
          ? "Transaction evidence verified."
          : "Transaction evidence incomplete or failed checks."}
      </p>
      <p className="small muted">{result.notice}</p>
      <p className="small muted mono">
        {result.signature.slice(0, 20)}…{result.signature.slice(-12)}
      </p>
    </div>
  );
}

export function QuickCheck() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickExtractResult>();
  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(undefined);
    try {
      setResult(await quickCheckTransaction(input, DEFAULT_RPC));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="quick-check" className="quick-section" aria-labelledby="quick-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">QUICK CHECK / FREE</p>
          <h2 id="quick-title">Paste. Inspect. Verify.</h2>
        </div>
        <span className="simulation">MAINNET READ-ONLY RPC</span>
      </div>
      <p className="quick-intro">
        Paste a Solscan transaction URL or Solana signature. VoucherGuard reads
        the confirmed transaction, extracts a Payment Channels V1 settlement
        voucher when present, and verifies the detached Ed25519 evidence in your
        browser. No wallet required.
      </p>
      <form className="quick-form" onSubmit={run}>
        <label className="sr-only" htmlFor="quick-input">
          Solscan URL or transaction signature
        </label>
        <input
          id="quick-input"
          data-testid="quick-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a Solscan transaction URL or Solana signature…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? "Verifying…" : "Verify transaction"}
        </button>
      </form>
      <p className="small muted">
        Or{" "}
        <a href="#playground">upload / edit a signed voucher</a> in Advanced
        Verification.
      </p>
      {result?.kind === "historical" && <HistoricalView result={result} />}
      {result?.kind === "unsupported" && (
        <p className="quick-empty" role="status" data-testid="quick-unsupported">
          No supported payment voucher found. {result.message}
        </p>
      )}
      {result?.kind === "not-found" && (
        <p className="quick-empty" role="status" data-testid="quick-error">
          {result.message}
        </p>
      )}
    </section>
  );
}
