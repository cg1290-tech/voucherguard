import type { PolicyDocument } from "@voucherguard/core";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PolicyBuilder } from "./PolicyBuilder";
import {
  fetchProStatus,
  type ProSessionState,
  stashPolicyForAdvanced,
} from "./pro-session";
import { TransactionReview } from "./TransactionReview";
import { Workbench } from "./Workbench";
import "./pro.css";
import "../style.css";

function ProTools() {
  const [policy, setPolicy] = useState<PolicyDocument | undefined>();
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
          <h1>Your Solana Transaction Workspace.</h1>
          <p>Paste a Solscan link. Review the evidence. Export your results.</p>
          <p className="small muted">
            Holder session verified for{" "}
            <code>{session.address?.slice(0, 8)}…</code>
          </p>
        </div>
        <a href="/#pro">Back to unlock</a>
      </header>
      <TransactionReview
        key={session.address}
        policy={policy}
        owner={session.address || "local"}
      />
      <details className="pro-file-tools">
        <summary>Optional: custom rules & saved policies</summary>
        <PolicyBuilder
          enabled
          owner={session.address || "local"}
          onPolicy={setPolicy}
          onApply={(policy: PolicyDocument) => {
            stashPolicyForAdvanced(policy);
            window.location.href = "/#playground";
          }}
        />
      </details>
      <details className="pro-file-tools">
        <summary>Advanced: voucher files & simulations</summary>
        <Workbench policy={policy} />
      </details>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<ProTools />);
