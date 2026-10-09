import { encodeBytes } from "@voucherguard/core";
import { getWallets } from "@wallet-standard/app";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { formatTokenUnits } from "./config";
import {
  createProSession,
  fetchProStatus,
  logoutProSession,
  type ProSessionState,
  requestChallenge,
} from "./pro-session";
import { WalletController } from "./wallet";
import "./pro.css";

const titles: Record<ProSessionState["status"], string> = {
  "not-configured": "Token access coming soon",
  locked: "Prove holdings to unlock",
  checking: "Checking access",
  eligible: "Pro unlocked",
  ineligible: "Holder threshold not met",
  "rpc-error": "Access could not be verified",
  error: "Pro gate unavailable",
};

export function Pro() {
  const [controller] = useState(() => new WalletController(getWallets()));
  const wallet = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [choice, setChoice] = useState("");
  const [session, setSession] = useState<ProSessionState>({
    status: "checking",
    message: "Checking Pro holder gate…",
  });
  const [busy, setBusy] = useState(false);
  const selected =
    wallet.wallets.find((w) => w.name === choice) ?? wallet.wallets[0];

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setSession(await fetchProStatus(signal));
    } catch {
      if (!signal?.aborted)
        setSession({
          status: "error",
          message:
            "Pro holder gate is unreachable. Use the Cloudflare Pages deployment.",
        });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function proveHoldings() {
    if (!wallet.account) return;
    setBusy(true);
    try {
      const challenge = await requestChallenge();
      const signature = await controller.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      const next = await createProSession(
        wallet.account.address,
        challenge.challenge,
        encodeBytes(signature, "base58"),
      );
      setSession(next);
    } catch (e) {
      setSession({
        status: "error",
        message:
          e instanceof Error ? e.message : "Holder proof failed. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await logoutProSession();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const eligible = session.status === "eligible";
  const toolsHref = session.toolsPath || "/pro.html";

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
        Policy Builder is served only after the Pages Worker verifies on-chain
        $VG holdings with a wallet signature. Quick Check and Advanced
        Verification stay free and need no wallet.
      </p>
      <div className="pro-access">
        <div className="pro-access-copy">
          <span
            className={`pro-state ${session.status}`}
            data-testid="pro-access-status"
          >
            {titles[session.status]}
          </span>
          <p role="status">{session.message}</p>
          {session.balance !== undefined && session.decimals !== undefined && (
            <p className="pro-balance">
              Holdings:{" "}
              <strong>
                {formatTokenUnits(BigInt(session.balance), session.decimals)} VG
              </strong>
              {session.required !== undefined && (
                <>
                  {" "}
                  · Required:{" "}
                  {formatTokenUnits(BigInt(session.required), session.decimals)}{" "}
                  VG
                </>
              )}
              {session.slot !== undefined && (
                <span className="pro-slot">
                  Observed at confirmed slot {session.slot}
                </span>
              )}
            </p>
          )}
          {session.mint && (
            <p className="small muted">
              Configured mint: <code className="pro-mint">{session.mint}</code>
            </p>
          )}
        </div>
        <div className="pro-wallet">
          <h3>Holder verification</h3>
          <p className="small muted">
            Connect a wallet, then sign a one-time Pro challenge. The Worker
            checks your $VG balance on Solana before issuing an HttpOnly
            session. No transaction is submitted.
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
                {!eligible && session.status !== "not-configured" && (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || wallet.connecting}
                    onClick={() => void proveHoldings()}
                  >
                    {busy ? "Verifying…" : "Prove holdings"}
                  </button>
                )}
                {eligible && (
                  <a className="button primary" href={toolsHref}>
                    Open Policy Builder
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={busy}
                >
                  Refresh
                </button>
                {eligible && (
                  <button
                    type="button"
                    onClick={() => void logout()}
                    disabled={busy}
                  >
                    End Pro session
                  </button>
                )}
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
            <p className="small-label">HOLDER TOOL / SERVER GATED</p>
            <h3>Policy Builder</h3>
            <p>
              Served from a Worker-protected route only after an on-chain holder
              session is issued.
            </p>
            <span className="pro-tool-label">
              Locked until the Worker verifies $VG holdings
            </span>
          </article>
        </div>
      )}
      <p className="pro-boundary">
        Hosted Pro access is enforced by the Cloudflare Pages Worker: a signed
        challenge plus live SPL balance against the configured mint. Client UI
        alone cannot issue a session. Open-source forks are outside this hosted
        gate.
      </p>
    </section>
  );
}
