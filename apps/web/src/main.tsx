import {
  encodeBytes,
  formatReport,
  type PolicyDocument,
  parsePolicyDocument,
  parseVoucherDocument,
  type Report,
  serializeReport,
  verifyVoucher,
} from "@voucherguard/core";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import scenarios from "./fixtures.json";
import "./style.css";
import { Pro } from "./pro/Pro";
import { applyPolicyToDocument } from "./pro/policy";

const repository = import.meta.env.VITE_REPOSITORY_URL as string | undefined;
const hexField = (value: string) => ({ encoding: "hex", value });
function App() {
  const [selected, setSelected] = useState("valid");
  const [payload, setPayload] = useState(
    JSON.stringify(scenarios[0]?.document, null, 2),
  );
  const [signer, setSigner] = useState(
    scenarios[0]?.document.authorizedSigner.value ?? "",
  );
  const [channel, setChannel] = useState(
    scenarios[0]?.document.policy.expectedChannelId.value ?? "",
  );
  const [cap, setCap] = useState("1000");
  const [increase, setIncrease] = useState("");
  const [now, setNow] = useState("1900000000");
  const [finite, setFinite] = useState(true);
  const [requireState, setRequireState] = useState(true);
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const invalidate = () => {
    setReport(undefined);
    setError("");
  };
  function applyProPolicy(policy: PolicyDocument) {
    const updated = applyPolicyToDocument(payload, policy);
    const parsed = parsePolicyDocument(policy);
    setPayload(updated);
    setChannel(
      parsed.expectedChannelId
        ? encodeBytes(parsed.expectedChannelId, "hex")
        : "",
    );
    setCap(policy.maxCumulativeAmount ?? "");
    setIncrease(policy.maxIncrease ?? "");
    setFinite(policy.rejectNonExpiring ?? false);
    setRequireState(policy.requireState ?? true);
    invalidate();
  }
  function load(id: string) {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) return;
    setSelected(id);
    setPayload(JSON.stringify(scenario.document, null, 2));
    setSigner(scenario.document.authorizedSigner.value);
    setChannel(scenario.document.policy.expectedChannelId.value);
    setCap("1000");
    setIncrease("");
    setNow("1900000000");
    setFinite(true);
    setRequireState(true);
    invalidate();
  }
  async function run() {
    setBusy(true);
    setError("");
    setReport(undefined);
    try {
      if (payload.length > 65536) throw new Error("Input exceeds 64 KiB");
      const doc = JSON.parse(payload) as Record<string, unknown>;
      if (!doc || typeof doc !== "object" || Array.isArray(doc))
        throw new Error("Payload must be an object");
      if (
        doc.policy !== undefined &&
        (!doc.policy ||
          typeof doc.policy !== "object" ||
          Array.isArray(doc.policy))
      )
        throw new Error("Policy must be an object");
      if (signer) doc.authorizedSigner = hexField(signer);
      else delete doc.authorizedSigner;
      if (now) doc.now = now;
      else delete doc.now;
      const policy: Record<string, unknown> = {
        ...(doc.policy as Record<string, unknown> | undefined),
        rejectNonExpiring: finite,
        requireState,
      };
      if (channel) policy.expectedChannelId = hexField(channel);
      else delete policy.expectedChannelId;
      if (cap) policy.maxCumulativeAmount = cap;
      else delete policy.maxCumulativeAmount;
      if (increase) policy.maxIncrease = increase;
      else delete policy.maxIncrease;
      doc.policy = policy;
      setReport(await verifyVoucher(parseVoucherDocument(doc)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid input");
    } finally {
      setBusy(false);
    }
  }
  function download(kind: "json" | "text") {
    if (!report) return;
    const blob = new Blob(
      [kind === "json" ? serializeReport(report) : formatReport(report)],
      { type: kind === "json" ? "application/json" : "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voucherguard-report.${kind === "json" ? "json" : "txt"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const scenario = scenarios.find((s) => s.id === selected);
  return (
    <>
      <a className="skip" href="#playground">
        Skip to playground
      </a>
      <header>
        <a className="brand" href="#top">
          Voucher<span>Guard</span>
          <span className="brand-mark" aria-hidden="true">
            {" "}
            /{" "}
          </span>
        </a>
        <nav aria-label="Main">
          <a href="#playground">Playground</a>
          <a href="#pro">Pro</a>
          <a href="#documentation">Documentation</a>
          <a href="#scope">Security model</a>
          {repository && (
            <a href={repository} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          )}
        </nav>
      </header>
      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">SIGNED INTENT. INDEPENDENT VERIFICATION.</p>
            <h1>
              AI agents can
              <br />
              spend money.
              <br />
              <span>
                Verify what
                <br className="mobile-break" /> they sign.
              </span>
            </h1>
            <p className="lede">
              Open-source verification for signed payment vouchers. Built for
              the next generation of agentic payments.
            </p>
            <div className="actions">
              <a className="primary" href="#playground">
                Launch Playground <span aria-hidden="true">↗</span>
              </a>
              {repository && (
                <a className="secondary" href={repository}>
                  View on GitHub ↗
                </a>
              )}
            </div>
            <p className="hero-note">
              Local execution · No wallet connection · MIT licensed
            </p>
          </div>
          <div
            className="wire-panel"
            role="img"
            aria-label="Voucher format diagram"
          >
            <div className="panel-heading">
              <span>SOLANA PAYMENT CHANNELS</span>
              <span>50 BYTES</span>
            </div>
            <div className="wire-title">
              Every byte
              <br />
              has a meaning.
            </div>
            <div className="byte-grid" aria-hidden="true">
              {Array.from({ length: 50 }, (_, offset) => offset).map((i) => (
                <span
                  key={`byte-${i}`}
                  className={
                    i < 2
                      ? "magic"
                      : i < 34
                        ? "channel-byte"
                        : i < 42
                          ? "amount-byte"
                          : "expiry-byte"
                  }
                >
                  {scenarios[0]?.document.message.value.slice(i * 2, i * 2 + 2)}
                </span>
              ))}
            </div>
            <dl className="wire-legend">
              <div>
                <dt>00—01 / DOMAIN</dt>
                <dd>0x56 · Version 1</dd>
              </div>
              <div>
                <dt>02—33 / CHANNEL</dt>
                <dd>32-byte channel address</dd>
              </div>
              <div>
                <dt>34—41 / AMOUNT</dt>
                <dd>Unsigned u64 · Little-endian</dd>
              </div>
              <div>
                <dt>42—49 / EXPIRATION</dt>
                <dd>Signed i64 · Unix seconds</dd>
              </div>
            </dl>
            <div className="wire-footer">
              Exact signed bytes → Ed25519 → Trusted context
            </div>
          </div>
        </section>
        <section className="intro" id="scope">
          <h2>
            A signature proves intent.
            <br />
            Context determines acceptance.
          </h2>
          <div>
            <p>
              VoucherGuard checks exact signed bytes, independently supplied
              signer and channel, expiration, amount caps and trusted
              watermarks. One TypeScript engine runs in your application,
              terminal and browser.
            </p>
            <p className="muted">
              Supports Solana Foundation payment channel V1 vouchers. This is
              not a complete x402 verifier. No payment execution, custody, RPC
              or backend.
            </p>
          </div>
        </section>
        <section id="playground" className="playground">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LOCAL VERIFICATION LAB</p>
              <h2>Inspect the authorization.</h2>
            </div>
            <span className="simulation">SIMULATIONS / TEST KEYS ONLY</span>
          </div>
          <div className="lab-layout">
            <aside className="scenario-list" aria-label="Security scenarios">
              <p className="small-label">CHOOSE A SCENARIO</p>
              {scenarios.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={selected === s.id}
                  onClick={() => load(s.id)}
                >
                  <span className="scenario-number">0{i + 1}</span>
                  <span>{s.name}</span>
                  <span className={`mini-status ${s.expected.toLowerCase()}`}>
                    {s.expected === "INDETERMINATE"
                      ? "?"
                      : s.expected === "PASS"
                        ? "✓"
                        : "×"}
                  </span>
                </button>
              ))}
              <p className="scenario-detail">{scenario?.detail}</p>
              <p className="muted small">
                Fixtures use explicit simulated Unix time. Replace it with your
                trusted clock for real inputs.
              </p>
            </aside>
            <div className="workbench">
              <div className="editor-heading">
                <h3>Signed voucher</h3>
                <span>JSON / HEX, BASE58, BASE64</span>
              </div>
              <label className="sr-only" htmlFor="payload">
                Signed voucher payload
              </label>
              <textarea
                id="payload"
                className="payload"
                spellCheck={false}
                value={payload}
                onChange={(e) => {
                  setPayload(e.target.value);
                  invalidate();
                }}
              />
              <p className="small muted">
                Paste the complete document. Controls below override its signer,
                channel, amount cap, time and toggles. Trusted state remains
                editable in JSON.
              </p>
              <div className="fields">
                <label className="full">
                  Expected authorized signer / hex
                  <input
                    value={signer}
                    spellCheck={false}
                    onChange={(e) => {
                      setSigner(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
                <label className="full">
                  Expected channel address / hex
                  <input
                    value={channel}
                    spellCheck={false}
                    onChange={(e) => {
                      setChannel(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
                <label>
                  Maximum cumulative amount
                  <input
                    inputMode="numeric"
                    placeholder="No application cap"
                    value={cap}
                    onChange={(e) => {
                      setCap(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
                <label>
                  Maximum increase
                  <input
                    inputMode="numeric"
                    placeholder="No increase cap"
                    value={increase}
                    onChange={(e) => {
                      setIncrease(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
                <label className="full">
                  Verification Unix time / seconds
                  <input
                    inputMode="numeric"
                    placeholder="Current local clock"
                    value={now}
                    onChange={(e) => {
                      setNow(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
              </div>
              <div className="toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={finite}
                    onChange={(e) => {
                      setFinite(e.target.checked);
                      invalidate();
                    }}
                  />
                  Require finite expiry
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={requireState}
                    onChange={(e) => {
                      setRequireState(e.target.checked);
                      invalidate();
                    }}
                  />
                  Require trusted channel state
                </label>
              </div>
              <div className="run-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={run}
                >
                  {busy ? "Verifying…" : "Verify locally"}
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPayload("");
                    setSigner("");
                    setChannel("");
                    setCap("");
                    setIncrease("");
                    setNow("");
                    setSelected("");
                    setFinite(true);
                    setRequireState(true);
                    invalidate();
                  }}
                >
                  Reset
                </button>
              </div>
              <div className="results" aria-live="polite">
                {error ? (
                  <div role="alert" className="error">
                    <strong>Input rejected</strong>
                    <p>{error}</p>
                  </div>
                ) : report ? (
                  <>
                    <div
                      className={`result-summary ${report.status.toLowerCase()}`}
                    >
                      <div>
                        <p className="small-label">VERIFICATION OUTCOME</p>
                        <h3 data-testid="status">{report.status}</h3>
                      </div>
                      <p>
                        {report.status === "PASS"
                          ? "All applicable checks passed with the supplied context."
                          : report.status === "FAIL"
                            ? "One or more checks failed. Inspect the evidence below."
                            : "Required context is missing. Acceptance is unresolved."}
                      </p>
                    </div>
                    <div className="checks">
                      {report.checks.map((c) => (
                        <div
                          key={`${c.code}-${c.explanation}`}
                          className="check"
                        >
                          <span
                            className={`check-status ${c.status.toLowerCase()}`}
                          >
                            {c.status === "PASS"
                              ? "✓"
                              : c.status === "FAIL"
                                ? "×"
                                : "?"}
                          </span>
                          <div>
                            <strong>{c.code}</strong>
                            <p>{c.explanation}</p>
                          </div>
                          <span className="check-category">{c.category}</span>
                        </div>
                      ))}
                    </div>
                    {report.decoded && (
                      <dl className="decoded">
                        {Object.entries(report.decoded).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <details>
                      <summary>Assumptions, evidence & limitations</summary>
                      <pre>{serializeReport(report)}</pre>
                    </details>
                    <div className="export">
                      <button type="button" onClick={() => download("json")}>
                        Export JSON ↗
                      </button>
                      <button type="button" onClick={() => download("text")}>
                        Export text ↗
                      </button>
                    </div>
                    <p className="small muted">
                      A PASS is conditional on your supplied inputs. It is not a
                      settlement guarantee or security certification.
                    </p>
                  </>
                ) : (
                  <div className="empty">
                    <span aria-hidden="true">[ ? ]</span>
                    <h3>Evidence before confidence.</h3>
                    <p>
                      Choose a scenario or paste a voucher, then run the actual
                      verification engine.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        <Pro onApply={applyProPolicy} />
        <section id="documentation" className="docs">
          <div>
            <p className="eyebrow">ONE ENGINE. THREE ENVIRONMENTS.</p>
            <h2>
              Bring verification
              <br />
              to your agents.
            </h2>
            <p>
              Keep public keys and channel snapshots outside untrusted agent
              output. Integer token amounts stay precise with BigInt.
            </p>
            <p className="muted">
              Node.js 22+ and modern browsers. Packages are prepared for manual
              release; install from the local workspace today.
            </p>
          </div>
          <div>
            <pre className="sdk">
              <code>{`import { verifyVoucher } from '@voucherguard/core';

const result = await verifyVoucher({
  message,           // exact 50 signed bytes
  signature,         // 64-byte Ed25519 signature
  authorizedSigner,  // independently trusted key
  now: 1900000000n,
  policy: {
    expectedChannelId,
    maxCumulativeAmount: 1000000n
  },
  trustedState       // authenticated channel snapshot
});

if (result.status !== 'PASS') reject(result);`}</code>
            </pre>
            <details>
              <summary>Local CLI and development</summary>
              <pre>{`pnpm install --frozen-lockfile
pnpm build
pnpm dev
node packages/cli/dist/index.js verify examples/valid.json --json
pnpm check`}</pre>
            </details>
          </div>
        </section>
        <section className="limits">
          <h2>Know the boundary.</h2>
          <div>
            <p>
              <strong>Inputs are your trust boundary.</strong> A key inside a
              payload is an assertion. Verify it independently. Supplied state
              may be stale; offline verification cannot detect competing
              submissions.
            </p>
            <p>
              <strong>Channel vouchers only.</strong> No x402 envelope,
              transaction, recipient distribution, balance or program deployment
              verification. State checks model ordinary settlement on an Open
              channel.
            </p>
            <p>
              <strong>No independent audit.</strong> VoucherGuard does not
              replace native on-chain checks. Test fixtures have public keys
              generated from a public test seed and never involve funds.
            </p>
          </div>
        </section>
      </main>
      <footer>
        <span className="brand">
          Voucher<span>Guard</span>
        </span>
        <span>Verify what your AI agents sign.</span>
        <span>Open source · MIT</span>
      </footer>
    </>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
