import { type FormEvent, useEffect, useRef, useState } from "react";
import { loadXRay, type XRayModel } from "../xray/model";
import { TransactionXRay } from "../xray/TransactionXRay";
import type { HistoricalTxReport, QuickExtractResult } from "./extract";

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
  const [xray, setXray] = useState<XRayModel>();
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abort.current?.abort(), []);
  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(undefined);
    setXray(undefined);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const review = await loadXRay(input, DEFAULT_RPC, (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        }),
      );
      if (!controller.signal.aborted) {
        setResult(review.result);
        setXray(review.xray);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      id="quick-check"
      className="quick-section"
      aria-labelledby="quick-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">TRANSACTION WORKSPACE / FREE</p>
          <h2 id="quick-title">Paste a link. Press Play.</h2>
        </div>
        <span className="simulation">MAINNET READ-ONLY RPC</span>
      </div>
      <p className="quick-intro">
        Explore Transaction X-Ray, compare Wallet Impact and inspect recognized
        failure explanations from one transaction lookup. Unsupported
        instructions and incomplete evidence stay visible.
      </p>
      <p className="quick-intro">
        Paste a Solscan URL or transaction signature. Start exploring without a
        wallet. When a supported Payment Channels V1 settlement voucher is
        present, its signed evidence is also verified in your browser.
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
          disabled={busy}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="primary"
          type="submit"
          disabled={busy || !input.trim()}
        >
          {busy ? "Loading…" : "Play transaction"}
        </button>
      </form>
      <p className="small muted">
        Or <a href="#playground">upload / edit a signed voucher</a> in Advanced
        Verification.
      </p>
      {xray && (
        <TransactionXRay key={result?.signature} model={xray} autoPlay />
      )}
      {result?.kind === "historical" && <HistoricalView result={result} />}
      {result?.kind === "unsupported" && (
        <p
          className="quick-empty"
          role="status"
          data-testid="quick-unsupported"
        >
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
