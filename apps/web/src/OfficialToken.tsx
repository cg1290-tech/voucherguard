import { useState } from "react";
// Public display address only. Hosted holder access remains configured by Worker secrets.
export const OFFICIAL_VG_MINT = "6haciZiuNuUvBvUnJa6SFB7bsxnpoW3Bz4R2cmpRpump";
export function OfficialToken() {
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(OFFICIAL_VG_MINT);
      setNotice("CA copied.");
    } catch {
      setNotice(
        "Copy unavailable. Select the address above and copy it manually.",
      );
    }
  }
  return (
    <section className="official-token" aria-label="Official VG token">
      <p className="eyebrow">$VG / SOLANA</p>
      <p className="small">Official token CA / mint address</p>
      <code className="official-token-address" data-testid="official-vg-ca">
        {OFFICIAL_VG_MINT}
      </code>
      <div className="official-token-actions">
        <button type="button" onClick={() => void copy()}>
          Copy CA
        </button>
        <a
          href={`https://solscan.io/token/${OFFICIAL_VG_MINT}`}
          target="_blank"
          rel="noreferrer"
        >
          Solscan ↗
        </a>
        <a
          href={`https://pump.fun/coin/${OFFICIAL_VG_MINT}`}
          target="_blank"
          rel="noreferrer"
        >
          Pump.fun ↗
        </a>
      </div>
      <p className="small muted" role="status">
        {notice}
      </p>
    </section>
  );
}
