import type { PolicyDocument } from "@voucherguard/core";
import { useEffect, useMemo, useState } from "react";
import {
  buildPolicy,
  CONSERVATIVE_POLICY,
  type PolicyDraft,
  STANDARD_POLICY,
} from "./policy";

import {
  draftFromPolicy,
  readLibrary,
  type SavedPolicy,
  tokenBaseUnits,
} from "./workspace";

export function PolicyBuilder({
  enabled,
  onApply,
  onPolicy,
  owner = "local",
}: {
  enabled: boolean;
  onApply: (policy: PolicyDocument) => void;
  onPolicy?: (policy: PolicyDocument | undefined) => void;
  owner?: string;
}) {
  const [draft, setDraft] = useState<PolicyDraft>({ ...STANDARD_POLICY });
  const storageKey = `vg_policies_${owner}`;
  const [tokenAmount, setTokenAmount] = useState("1");
  const [decimals, setDecimals] = useState("6");
  const [name, setName] = useState("My agent policy");
  const [library, setLibrary] = useState<SavedPolicy[]>([]);
  useEffect(() => {
    try {
      setLibrary(readLibrary(localStorage.getItem(storageKey)));
    } catch {
      setNotice(
        "Saved policies could not be read. Import a backup to recover them.",
      );
    }
  }, [storageKey]);
  const [notice, setNotice] = useState("");
  const { policy, error } = useMemo(() => {
    try {
      return { policy: buildPolicy(draft), error: "" };
    } catch (e) {
      return {
        policy: undefined,
        error: e instanceof Error ? e.message : "Invalid policy inputs.",
      };
    }
  }, [draft]);
  const json = policy ? JSON.stringify(policy, null, 2) : "";
  useEffect(() => {
    onPolicy?.(policy);
  }, [policy, onPolicy]);
  function save() {
    if (!policy || !enabled) return;
    const title = name.trim();
    if (!title || title.length > 80) {
      setNotice("Use a policy name of 1–80 characters.");
      return;
    }
    if (library.length >= 100) {
      setNotice(
        "Library limit reached. Export your policies before removing revisions.",
      );
      return;
    }
    const revision =
      Math.max(
        0,
        ...library.filter((p) => p.name === title).map((p) => p.revision),
      ) + 1;
    const next = [
      {
        id: crypto.randomUUID(),
        name: title,
        revision,
        savedAt: new Date().toISOString(),
        policy,
      },
      ...library,
    ];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setLibrary(next);
      setNotice(
        `Saved ${title}, revision ${revision}. Stored in this browser only.`,
      );
    } catch {
      setNotice(
        "Browser storage is unavailable. Download your policy instead.",
      );
    }
  }
  async function importPolicy(file: File | undefined) {
    if (!file || !enabled) return;
    try {
      if (file.size > 65536) throw Error("Policy import is limited to 64 KiB.");
      const value = JSON.parse(await file.text());
      const policy = value.protocol ? value.policy : value;
      setDraft(draftFromPolicy(policy));
      setNotice(
        "Policy imported. Confirm the expected channel independently before use.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Import failed.");
    }
  }
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
        "Policy applied to Advanced Verification. Voucher message, signature and state are preserved.",
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
      <div className="pro-guided">
        <h4>Quick setup</h4>
        <p className="small muted">
          Use the decimals of the voucher’s payment token. This is separate from
          VG holder access.
        </p>
        <div className="pro-library">
          <label>
            Payment token decimals
            <input
              inputMode="numeric"
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
            />
          </label>
          <label>
            Spending limit in tokens
            <input
              inputMode="decimal"
              value={tokenAmount}
              onChange={(e) => setTokenAmount(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!enabled}
            onClick={() => {
              try {
                edit({
                  maxCumulativeAmount: tokenBaseUnits(tokenAmount, decimals),
                });
                setNotice(
                  "Spending limit converted exactly to token base units.",
                );
              } catch (e) {
                setNotice(e instanceof Error ? e.message : "Invalid amount.");
              }
            }}
          >
            Set spending limit
          </button>
          <label>
            Expiry window
            <select
              defaultValue=""
              disabled={!enabled}
              onChange={(e) => {
                if (e.target.value)
                  edit({
                    rejectNonExpiring: true,
                    minRemainingSeconds: "30",
                    maxRemainingSeconds: e.target.value,
                  });
              }}
            >
              <option value="">Choose a validity window</option>
              <option value="300">30 seconds – 5 minutes</option>
              <option value="3600">30 seconds – 1 hour</option>
              <option value="86400">30 seconds – 24 hours</option>
            </select>
          </label>
        </div>
      </div>
      <div className="pro-library">
        <label>
          Policy name
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="button" disabled={!enabled || !policy} onClick={save}>
          Save revision
        </button>
        <label className="file-control">
          Import policy or voucher
          <input
            type="file"
            accept=".json,application/json"
            disabled={!enabled}
            onChange={(e) => {
              void importPolicy(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Saved policies
          <select
            aria-label="Saved policies"
            defaultValue=""
            onChange={(e) => {
              const saved = library.find((p) => p.id === e.target.value);
              if (saved) {
                setDraft(draftFromPolicy(saved.policy));
                setName(saved.name);
                setNotice(`Loaded revision ${saved.revision}.`);
              }
            }}
          >
            <option value="">Choose a saved revision</option>
            {library.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · v{p.revision}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="pro-advanced">
        <summary>Advanced constraints & JSON</summary>
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
                  onChange={(e) =>
                    edit({ maxCumulativeAmount: e.target.value })
                  }
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
                  onChange={(e) =>
                    edit({ minRemainingSeconds: e.target.value })
                  }
                />
              </label>
              <label>
                Maximum remaining validity / seconds
                <input
                  inputMode="numeric"
                  value={draft.maxRemainingSeconds}
                  placeholder="No maximum window"
                  onChange={(e) =>
                    edit({ maxRemainingSeconds: e.target.value })
                  }
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
                  onChange={(e) =>
                    edit({ rejectNonExpiring: e.target.checked })
                  }
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
              An empty optional field omits that application constraint. A
              missing expected channel or requested state may produce
              INDETERMINATE during verification.
            </p>
          </div>
        </div>
      </details>
      <div className="pro-builder-actions">
        <button
          type="button"
          className="primary"
          disabled={!enabled || !policy}
          onClick={apply}
        >
          Apply to Advanced
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
