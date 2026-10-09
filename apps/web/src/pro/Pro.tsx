import type { PolicyDocument } from "@voucherguard/core";
import { getWallets } from "@wallet-standard/app";
import { useState, useSyncExternalStore } from "react";
import { formatTokenUnits, loadProConfig, validateConfig } from "./config";
import { SolanaOwnershipReader } from "./eligibility";
import { PolicyBuilder } from "./PolicyBuilder";
import { useAccess } from "./useAccess";
import { WalletController } from "./wallet";
import "./pro.css";

const titles = {
  "not-configured": "Token access coming soon",
  disconnected: "Connect to check access",
  checking: "Checking access",
  eligible: "Pro unlocked",
  ineligible: "Holder threshold not met",
  "unsupported-network": "Unsupported network",
  "rpc-error": "Access could not be verified",
} as const;
export function Pro({
  onApply,
}: {
  onApply: (policy: PolicyDocument) => void;
}) {
  const [config] = useState(loadProConfig);
  const [controller] = useState(() => new WalletController(getWallets()));
  const [reader] = useState(() => new SolanaOwnershipReader());
  const wallet = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [choice, setChoice] = useState("");
  const { result, refresh } = useAccess(config, wallet, reader);
  const selected =
    wallet.wallets.find((w) => w.name === choice) ?? wallet.wallets[0];
  const eligible = result.status === "eligible";
  const setup = validateConfig(config);
  return (
    <section id="pro" className="pro-section" aria-labelledby="pro-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VOUCHERGUARD PRO / HOLDER TOOLKIT</p>
          <h2 id="pro-title">Your policies. Your guardrails.</h2>
        </div>
        <span className="pro-network">SOLANA MAINNET-BETA</span>
      </div>
      <p className="pro-intro">
        Build, export and apply verification policies with Policy Builder.
        {setup.status === "ready"
          ? " Connect a read-only wallet to verify configured mint holdings and unlock Pro tools."
          : " Holder access activates after the official mint is configured."}{" "}
        Pro checks eligibility through a read-only wallet connection and public
        Solana RPC. The verification playground stays free, with no wallet or
        RPC required.
      </p>
      <div className="pro-access">
        <div className="pro-access-copy">
          <span
            className={`pro-state ${result.status}`}
            data-testid="pro-access-status"
          >
            {titles[result.status]}
          </span>
          <p role="status">{result.message}</p>
          {result.balance !== undefined && result.decimals !== undefined && (
            <p className="pro-balance">
              Holdings:{" "}
              <strong>
                {formatTokenUnits(result.balance, result.decimals)} VG
              </strong>{" "}
              · Required: {config.threshold} VG
              <span className="pro-slot">
                Observed at confirmed slot {result.slot}
              </span>
            </p>
          )}
          {setup.status === "ready" ? (
            <p className="small muted">
              Configured mint: <code className="pro-mint">{config.mint}</code>
            </p>
          ) : (
            <p className="small muted">
              No token mint or launch status is implied. Access activates only
              after the official mint is configured.
            </p>
          )}
        </div>
        <div className="pro-wallet">
          <h3>Read-only wallet connection</h3>
          <p className="small muted">
            Shares a public account address. No signature, transaction,
            approval, delegation, private key or seed phrase is requested.
          </p>
          {wallet.account ? (
            <>
              <p className="pro-wallet-address">
                {wallet.wallet?.name} ·{" "}
                <code title={wallet.account.address}>
                  {wallet.account.address.slice(0, 8)}…
                  {wallet.account.address.slice(-8)}
                </code>
              </p>
              {wallet.accounts.length > 1 && (
                <label className="pro-select">
                  Wallet account
                  <select
                    value={wallet.account.address}
                    onChange={(e) => controller.selectAccount(e.target.value)}
                  >
                    {wallet.accounts.map((a) => (
                      <option key={a.address} value={a.address}>
                        {a.label || a.address}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="pro-wallet-actions">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={
                    result.status === "checking" || setup.status !== "ready"
                  }
                >
                  Refresh access
                </button>
                <button
                  type="button"
                  onClick={() => void controller.disconnect()}
                >
                  Disconnect wallet
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="pro-select">
                Solana wallet
                <select
                  value={selected?.name ?? ""}
                  disabled={!wallet.wallets.length || wallet.connecting}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  {!wallet.wallets.length && (
                    <option value="">No compatible wallet detected</option>
                  )}
                  {wallet.wallets.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="primary"
                disabled={!selected || wallet.connecting}
                onClick={() => {
                  if (selected) void controller.connect(selected);
                }}
              >
                {wallet.connecting ? "Connecting…" : "Connect wallet"}
              </button>
              {!wallet.wallets.length && (
                <p className="small muted pro-no-wallet">
                  Open this page with a Wallet Standard-compatible Solana wallet
                  available.
                </p>
              )}
            </>
          )}
          {wallet.error && (
            <p className="pro-wallet-error" role="alert">
              {wallet.error}
            </p>
          )}
        </div>
      </div>
      {!eligible && (
        <div className="pro-tools">
          <article>
            <p className="small-label">HOLDER TOOL / AVAILABLE AFTER UNLOCK</p>
            <h3>Policy Builder</h3>
            <p>
              Set amount and time limits, generate validated JSON, and apply
              your policy to the free playground.
            </p>
            <span className="pro-tool-label">
              Locked until holdings are verified
            </span>
          </article>
          <div className="pro-coming">
            <p className="small-label">COMING LATER / NOT IMPLEMENTED</p>
            <h3>Batch Verification</h3>
            <p>Potential future tool for inspecting multiple vouchers.</p>
            <h3>Advanced Reports</h3>
            <p>Potential future report views. No release date is promised.</p>
          </div>
        </div>
      )}
      <div hidden={!eligible}>
        <PolicyBuilder
          enabled={eligible}
          onApply={(policy) => {
            if (eligible) onApply(policy);
          }}
        />
      </div>
      {eligible && (
        <p className="pro-future">
          Coming later: Batch Verification and Advanced Reports. These planned
          tools are not implemented.
        </p>
      )}
      <p className="pro-boundary">
        Client-side token gating is a convenience feature and can be bypassed.
        Bundled tools are public code; this gate protects no secrets or
        privileged operations. Token ownership and voucher verification are
        separate checks.
      </p>
    </section>
  );
}
