import type { PolicyDocument } from "@voucherguard/core";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PolicyBuilder } from "./PolicyBuilder";
import {
  fetchProStatus,
  type ProSessionState,
  stashPolicyForAdvanced,
} from "./pro-session";
import "./pro.css";
import "../style.css";

function ProTools() {
  const [session, setSession] = useState<ProSessionState>({
    status: "checking",
    message: "Confirming holder session…",
  });
  useEffect(() => {
    const controller = new AbortController();
    void fetchProStatus(controller.signal)
      .then((state) => {
        if (state.status !== "eligible") {
          window.location.replace("/#pro");
          return;
        }
        setSession(state);
      })
      .catch(() => window.location.replace("/#pro"));
    return () => controller.abort();
  }, []);

  if (session.status !== "eligible") {
    return (
      <main className="pro-tools-page">
        <p role="status">{session.message}</p>
      </main>
    );
  }

  return (
    <main className="pro-tools-page">
      <header className="pro-tools-header">
        <div>
          <p className="eyebrow">VOUCHERGUARD PRO</p>
          <h1>Policy Builder</h1>
          <p className="small muted">
            Holder session verified for{" "}
            <code>{session.address?.slice(0, 8)}…</code>
          </p>
        </div>
        <a href="/#pro">Back to unlock</a>
      </header>
      <PolicyBuilder
        enabled
        onApply={(policy: PolicyDocument) => {
          stashPolicyForAdvanced(policy);
          window.location.href = "/#";
        }}
      />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<ProTools />);
