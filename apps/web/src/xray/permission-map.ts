import type { RuleReport } from "../pro/transaction-rules";
import type { XRayModel, XRayStep } from "./model";
export function stepFlagged(step: XRayStep, report?: RuleReport): boolean {
  return (
    !!report &&
    ((report.rules.restrictPrograms &&
      !!step.program &&
      !report.rules.allowedPrograms.includes(step.program)) ||
      (report.rules.flagDelegations &&
        step.permissionAction === "Spending delegation") ||
      (report.rules.flagAuthorityChanges &&
        step.permissionAction === "Authority change"))
  );
}
export interface PermissionNode {
  id: string;
  label: string;
  address?: string;
  x: number;
  y: number;
}
export interface PermissionLink {
  id: string;
  from: string;
  to: string;
  step: XRayStep;
  state: "recorded" | "attempted" | "not-reached" | "unknown";
  flagged: boolean;
}
export function buildPermissionMap(model: XRayModel, rules?: RuleReport) {
  const nodes = new Map<string, PermissionNode>();
  const links: PermissionLink[] = [];
  const operations = model.steps.filter(
    (s) => s.kind === "permission" && s.from,
  );
  for (const step of operations) {
    const from = step.from as string;
    const to = step.to || `operation:${step.id}`;
    const additions = [from, to].filter(
      (id, i, a) => !nodes.has(id) && a.indexOf(id) === i,
    );
    if (links.length >= 24 || nodes.size + additions.length > 16) continue;
    nodes.set(
      from,
      nodes.get(from) ?? { id: from, label: from, address: from, x: 0, y: 0 },
    );
    if (!nodes.has(to))
      nodes.set(
        to,
        step.to
          ? { id: to, label: to, address: to, x: 0, y: 0 }
          : {
              id: to,
              label:
                step.permissionAction === "Delegation revocation"
                  ? "Revocation"
                  : step.permissionAction === "Authority change"
                    ? "Authority removal"
                    : step.label,
              x: 0,
              y: 0,
            },
      );
    links.push({
      id: step.id,
      from,
      to,
      step,
      flagged: stepFlagged(step, rules),
      state:
        model.execution === "succeeded"
          ? "recorded"
          : model.execution === "unknown"
            ? "unknown"
            : model.failure?.instructionIndex !== undefined &&
                step.instructionIndex !== undefined &&
                step.instructionIndex > model.failure.instructionIndex
              ? "not-reached"
              : "attempted",
    });
  }
  const placed = [...nodes.values()];
  placed.forEach((node, i) => {
    if (placed.length <= 2) {
      node.x = placed.length === 1 ? 400 : i === 0 ? 190 : 610;
      node.y = 270;
      return;
    }
    const angle = (2 * Math.PI * i) / placed.length - Math.PI / 2;
    node.x = 400 + 270 * Math.cos(angle);
    node.y = 270 + 190 * Math.sin(angle);
  });
  return {
    nodes: placed,
    links,
    omitted: operations.length - links.length,
    incomplete:
      !model.insights.permissionsComplete ||
      model.gaps.length > 0 ||
      operations.length > links.length,
  };
}
