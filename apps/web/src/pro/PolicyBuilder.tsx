import type { PolicyDocument } from "@voucherguard/core";
import { useState } from "react";
import {
  buildPolicy,
  CONSERVATIVE_POLICY,
  type PolicyDraft,
  STANDARD_POLICY,
} from "./policy";

export function PolicyBuilder({
  enabled,
  onApply,
}: {
  enabled: boolean;
  onApply: (policy: PolicyDocument) => void;
}) {
  const [draft, setDraft] = useState<PolicyDraft>({ ...STANDARD_POLICY });
  const [notice, setNotice] = useState("");
  let policy: PolicyDocument | undefined;
  let error = "";
  try {
    policy = buildPolicy(draft);
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid policy inputs.";
  }
  const json = policy ? JSON.stringify(policy, null, 2) : "";
  function edit(patch: Partial<PolicyDraft>) {
    setDraft((old) => ({ ...old, ...patch }));
    setNotice("");
  }
  function choose(preset: PolicyDraft) {
    setDraft({ ...preset });
    setNotice(
      "Example preset loaded. Adjust values for your token and application.",
    );
  }
  async function copy() {
    if (!enabled || !policy) return;
    try {
      await navigator.clipboard.writeText(json);
      setNotice("Policy JSON copied.");
    } catch {
      setNotice(
        "Clipboard access failed. Select the JSON preview to copy it, or download the file.",
      );
    }
  }
  function download() {
    if (!enabled || !policy) return;
    const url = URL.createObjectURL(
      new Blob([`${json}\n`], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "voucherguard-policy.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Policy JSON downloaded.");
  }
  function apply() {
    if (!enabled || !policy) return;
    try {
      onApply(policy);
      setNotice(
        "Policy applied to the playground. Voucher message, signature and state are preserved.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not apply the policy.");
    }
  }
  return (
    <div className="pro-builder" data-testid="policy-builder">
      <div className="pro-builder-heading">
        <div>
          <p className="eyebrow">HOLDER TOOL / LOCAL EXECUTION</p>
          <h3>Policy Builder</h3>
        </div>
        <div className="pro-presets">
          <button
            type="button"
            disabled={!enabled}
            onClick={() => choose(STANDARD_POLICY)}
          >
            Standard example
          </button>
          <button
            type="button"
            disabled={!enabled}
            onClick={() => choose(CONSERVATIVE_POLICY)}
          >
            Conservative example
          </button>
        </div>
      </div>
      <p className="small muted">
        Presets are configurable examples, not security guarantees. Amounts use
        voucher token base units; these are separate from the $VG holder
        threshold.
      </p>
      <div className="pro-builder-grid">
        <fieldset disabled={!enabled}>
          <legend className="sr-only">Policy settings</legend>
          <div className="fields">
            <label>
              Maximum cumulative amount
              <input
                inputMode="numeric"
                value={draft.maxCumulativeAmount}
                placeholder="No application cap"
                onChange={(e) => edit({ maxCumulativeAmount: e.target.value })}
              />
            </label>
            <label>
              Maximum authorized increase
              <input
                inputMode="numeric"
                value={draft.maxIncrease}
                placeholder="No increase cap"
                onChange={(e) => edit({ maxIncrease: e.target.value })}
              />
            </label>
            <label>
              Minimum remaining validity / seconds
              <input
                inputMode="numeric"
                value={draft.minRemainingSeconds}
                placeholder="No minimum window"
                onChange={(e) => edit({ minRemainingSeconds: e.target.value })}
              />
            </label>
            <label>
              Maximum remaining validity / seconds
              <input
                inputMode="numeric"
                value={draft.maxRemainingSeconds}
                placeholder="No maximum window"
                onChange={(e) => edit({ maxRemainingSeconds: e.target.value })}
              />
            </label>
            <label className="full">
              Expected channel identifier
              <input
                spellCheck={false}
                value={draft.expectedChannelId}
                placeholder="Supply your independently expected channel"
                onChange={(e) => edit({ expectedChannelId: e.target.value })}
              />
            </label>
            <label className="full">
              Channel encoding
              <select
                value={draft.channelEncoding}
                onChange={(e) =>
                  edit({
                    channelEncoding: e.target
                      .value as PolicyDraft["channelEncoding"],
                  })
                }
              >
                <option value="hex">Hex</option>
                <option value="base58">Base58</option>
                <option value="base64">Base64</option>
              </select>
            </label>
          </div>
          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={draft.rejectNonExpiring}
                onChange={(e) => edit({ rejectNonExpiring: e.target.checked })}
              />
              Require finite expiration
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.requireState}
                onChange={(e) => edit({ requireState: e.target.checked })}
              />
              Require trusted channel state
            </label>
          </div>
        </fieldset>
        <div className="pro-policy-preview">
          <p className="small-label">GENERATED POLICY JSON</p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : (
            <pre data-testid="policy-json">{json}</pre>
          )}
          <p className="small muted">
            An empty optional field omits that application constraint. A missing
            expected channel or requested state may produce INDETERMINATE during
            verification.
          </p>
        </div>
      </div>
      <div className="pro-builder-actions">
        <button
          type="button"
          className="primary"
          disabled={!enabled || !policy}
          onClick={apply}
        >
          Apply to playground
        </button>
        <button type="button" disabled={!enabled || !policy} onClick={copy}>
          Copy JSON
        </button>
        <button type="button" disabled={!enabled || !policy} onClick={download}>
          Download policy
        </button>
        <button
          type="button"
          disabled={!enabled}
          onClick={() => {
            setDraft({ ...STANDARD_POLICY });
            setNotice("Builder reset to defaults.");
          }}
        >
          Reset builder
        </button>
      </div>
      <p className="small pro-notice" role="status">
        {notice}
      </p>
    </div>
  );
}
