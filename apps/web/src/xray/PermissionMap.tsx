import { useId, useMemo, useState } from "react";
import { displayUnits } from "../pro/transaction-insights";
import type { RuleReport } from "../pro/transaction-rules";
import type { XRayModel } from "./model";
import { buildPermissionMap } from "./permission-map";

const short = (v: string) =>
  v.length > 20 ? `${v.slice(0, 5)}…${v.slice(-4)}` : v;
export function PermissionMap({
  model,
  rules,
}: {
  model: XRayModel;
  rules?: RuleReport | undefined;
}) {
  const markerId = useId();
  const map = useMemo(() => buildPermissionMap(model, rules), [model, rules]);
  const [nodeId, setNodeId] = useState("");
  const [linkId, setLinkId] = useState("");
  const node = map.nodes.find((n) => n.id === nodeId);
  const active = map.links.find((l) => l.id === linkId);
  const relevant = node
    ? map.links.filter((l) => l.from === node.id || l.to === node.id)
    : map.links;
  return (
    <section
      className="permission-map"
      data-testid="permission-map"
      aria-label="Permission Map"
    >
      <p className="eyebrow">PERMISSION MAP / RECORDED OPERATIONS</p>
      <h3>See the permission connections.</h3>
      <p>
        Account nodes are addresses from decoded instructions. Operation nodes
        show revocation, removal or other selected account actions; they are not
        wallet addresses.
      </p>
      <p>
        {map.links.length} mapped operation{map.links.length === 1 ? "" : "s"} ·{" "}
        {map.nodes.length} nodes
        {map.omitted
          ? ` · ${map.omitted} operations omitted by display limits`
          : ""}
        .{" "}
        {map.incomplete
          ? "Coverage incomplete. Other permissions or operations may be missing."
          : "Selected supported operations decoded; arbitrary program permissions are not assessed."}
      </p>
      {map.links.length ? (
        <>
          <div className="permission-map-scroll">
            <div
              className={`permission-map-canvas ${map.nodes.length <= 2 ? "map-simple" : ""}`}
            >
              <svg
                viewBox="0 0 800 540"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id={markerId}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path
                      d="M 0 0 L 10 5 L 0 10 Z"
                      className="permission-map-arrow"
                    />
                  </marker>
                </defs>
                {map.links.map((l) => {
                  const a = map.nodes.find((n) => n.id === l.from),
                    b = map.nodes.find((n) => n.id === l.to);
                  if (!a || !b) return null;
                  const distance = Math.hypot(400 - b.x, 270 - b.y) || 1;
                  const endX = b.x + ((400 - b.x) * 55) / distance,
                    endY = b.y + ((270 - b.y) * 55) / distance;
                  return (
                    <g
                      key={l.id}
                      className={`${l.flagged ? "map-rule-flag" : ""} ${l.state !== "recorded" ? "map-attempt" : ""} ${active?.id === l.id ? "map-active" : ""} ${l.step.permissionAction === "Delegation revocation" || (l.step.permissionAction === "Authority change" && !l.step.to) ? "map-removal" : ""}`}
                    >
                      <path
                        markerEnd={`url(#${markerId})`}
                        d={
                          a.id === b.id
                            ? `M ${a.x - 40} ${a.y - 20} C ${a.x - 100} ${a.y - 120} ${a.x + 100} ${a.y - 120} ${a.x + 40} ${a.y - 20}`
                            : `M ${a.x} ${a.y} Q 400 270 ${endX} ${endY}`
                        }
                      />
                      <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="4" />
                    </g>
                  );
                })}
              </svg>
              {map.nodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`permission-map-node ${n.address ? "" : "map-operation"}`}
                  style={{ left: `${n.x / 8}%`, top: `${n.y / 5.4}%` }}
                  aria-pressed={nodeId === n.id}
                  title={n.label}
                  onClick={() => {
                    setNodeId(n.id);
                    setLinkId("");
                  }}
                >
                  <small>{n.address ? "Account" : "Operation"}</small>
                  <strong>{short(n.label)}</strong>
                </button>
              ))}
            </div>
          </div>
          {node && (
            <p className="xray-raw">
              Selected {node.address ? "account" : "operation"}: {node.label}{" "}
              <button type="button" onClick={() => setNodeId("")}>
                Show all connections
              </button>
            </p>
          )}
          <div className="permission-map-links">
            {relevant.map((l) => (
              <button
                type="button"
                key={l.id}
                className={l.flagged ? "xray-alert" : ""}
                aria-pressed={active?.id === l.id}
                onClick={() => setLinkId(l.id)}
              >
                {l.step.position} · {l.step.label} · {l.state}
                {l.flagged ? " · Pro rule flagged" : ""}
              </button>
            ))}
          </div>
          {active && (
            <section
              className="permission-map-detail"
              aria-label="Selected permission connection"
            >
              <h4>{active.step.label}</h4>
              <p>
                Source account: <code>{active.from}</code>
              </p>
              <p>
                {active.step.to
                  ? "Recorded endpoint"
                  : "Operation; prior endpoint not established"}
                :{" "}
                <code>
                  {active.step.to ||
                    map.nodes.find((n) => n.id === active.to)?.label}
                </code>
              </p>
              {active.step.amount !== undefined && (
                <p>
                  Recorded allowance:{" "}
                  {active.step.decimals !== undefined
                    ? `${displayUnits(active.step.amount, active.step.decimals)} tokens`
                    : `${active.step.amount} base units`}
                  .{" "}
                  {active.step.asset
                    ? `Mint: ${active.step.asset}`
                    : "Mint/precision not established."}
                </p>
              )}
              <p>{active.step.details}</p>
              <p>
                Execution: {active.state}.{" "}
                {active.flagged
                  ? "This operation matches captured Pro delegation/authority alerts or references a program outside your saved list."
                  : ""}
              </p>
              <p>
                Program: <code>{active.step.program}</code>
              </p>
            </section>
          )}
        </>
      ) : (
        <p>
          No supported permission operations were mapped. This does not prove
          that the transaction grants no permissions.
        </p>
      )}
      <p className="small muted">
        Historical operations, not currently active permissions. Repeated or
        opposing operations remain separate; no final permission state is
        inferred. Failed transactions do not establish applied permission
        changes. Mapping and inspection make no extra RPC requests.
      </p>
    </section>
  );
}
