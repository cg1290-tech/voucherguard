import { useEffect, useRef, useState } from "react";
import {
  createProSession,
  logoutProSession,
  type ProSessionState,
  requestChallenge,
} from "./pro-session";
import { connectRobinhood, type RobinhoodConnection } from "./robinhood-wallet";

export function RobinhoodWallet({
  session,
  onSession,
  onRefresh,
}: {
  session: ProSessionState;
  onSession(state: ProSessionState): void;
  onRefresh(): Promise<void>;
}) {
  const connection = useRef<RobinhoodConnection | null>(null);
  const generation = useRef(0);
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      generation.current++;
      connection.current?.dispose();
    },
    [],
  );
  async function connect() {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const connected = await connectRobinhood(
        session.walletConnectProjectId || "",
        (uri) => {
          void import("qrcode")
            .then((m) => m.default.toDataURL(uri, { width: 288, margin: 2 }))
            .then((image) => {
              if (generation.current === request) setQr(image);
            })
            .catch(() => {
              if (generation.current === request)
                setError("Could not display the connection code. Try again.");
            });
        },
        () => {
          generation.current++;
          setAddress("");
          setQr("");
          setBusy(false);
          connection.current?.dispose();
          connection.current = null;
          onSession({
            status: "locked",
            network: "robinhood",
            message:
              "Wallet changed or disconnected. Reconnect to verify access.",
          });
          void logoutProSession()
            .then(onRefresh)
            .catch(() => {});
        },
      );
      if (request !== generation.current) {
        await connected.disconnect();
        return;
      }
      connection.current = connected;
      setAddress(connected.address);
      setQr("");
    } catch {
      if (request === generation.current)
        setError("Wallet connection was declined or unavailable. Try again.");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function prove() {
    const connected = connection.current;
    if (!connected) return;
    const request = generation.current;
    setBusy(true);
    setError("");
    try {
      const challenge = await requestChallenge(undefined, connected.address);
      if (request !== generation.current) return;
      const signature = await connected.sign(challenge.message);
      if (request !== generation.current) return;
      const result = await createProSession(
        connected.address,
        challenge.challenge,
        signature,
      );
      if (request !== generation.current) {
        await logoutProSession();
        return;
      }
      onSession(result);
    } catch {
      if (request === generation.current)
        setError(
          "Access could not be verified. No transaction was submitted. Try again.",
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function disconnect() {
    generation.current++;
    const connected = connection.current;
    connection.current = null;
    setAddress("");
    setQr("");
    setBusy(false);
    onSession({
      status: "locked",
      network: "robinhood",
      message: "Wallet disconnected. Access is locked.",
    });
    try {
      const results = await Promise.allSettled([
        logoutProSession(),
        connected?.disconnect(),
      ]);
      if (results.some((r) => r.status === "rejected"))
        throw new Error("Disconnect failed");
      await onRefresh();
    } catch {
      setError(
        "Disconnected locally. Revoke the connection in your wallet if needed.",
      );
    }
  }
  const eligible = session.status === "eligible";
  return (
    <>
      <h3>Robinhood Wallet</h3>
      <p className="small muted">
        Connect Robinhood Wallet and sign a short-lived access message. Your $VG
        balance is checked on Robinhood Chain. No payment or token approval is
        requested.
      </p>
      {address && (
        <p className="pro-wallet-address">
          <code title={address}>
            {address.slice(0, 8)}…{address.slice(-6)}
          </code>
        </p>
      )}
      {qr && (
        <div className="pro-connection-code">
          <img
            src={qr}
            width="288"
            height="288"
            alt="Scan this connection code in Robinhood Wallet"
          />
          <p className="small">
            In Robinhood Wallet, open WalletConnect and scan this code.
          </p>
        </div>
      )}
      <div className="pro-wallet-actions">
        {!address && !eligible && (
          <button
            type="button"
            className="primary"
            disabled={busy || !session.walletConnectProjectId}
            onClick={() => void connect()}
          >
            {busy ? "Waiting for wallet…" : "Connect Robinhood Wallet"}
          </button>
        )}
        {address && !eligible && (
          <button
            type="button"
            className="primary"
            disabled={busy || session.status === "not-configured"}
            onClick={() => void prove()}
          >
            {busy ? "Verifying…" : "Prove holdings"}
          </button>
        )}
        {eligible && (
          <a className="button primary" href={session.toolsPath || "/pro.html"}>
            Open Policy Builder
          </a>
        )}
        {address && (
          <button type="button" onClick={() => void disconnect()}>
            Disconnect wallet
          </button>
        )}
        {qr && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setQr("");
              setBusy(false);
            }}
          >
            Cancel connection
          </button>
        )}
        {eligible && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            End Pro session
          </button>
        )}
      </div>
      {!session.walletConnectProjectId && (
        <p className="small muted">Robinhood Wallet connection coming soon.</p>
      )}
      {error && (
        <p className="pro-wallet-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
