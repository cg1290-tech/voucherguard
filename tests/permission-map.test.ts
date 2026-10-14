import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../apps/web/src/pro/transaction-rules";
import {
  buildXRay,
  type XRayModel,
  type XRayStep,
} from "../apps/web/src/xray/model";
import { buildPermissionMap } from "../apps/web/src/xray/permission-map";

const operation = (id: string, action: string, to?: string): XRayStep => ({
  id,
  position: id,
  program: "token-program",
  kind: "permission",
  label: action,
  details: "Recorded evidence",
  permissionAction: action,
  from: "source",
  ...(to ? { to } : {}),
  instructionIndex: 0,
});
function model(steps: XRayStep[]): XRayModel {
  return { ...buildXRay({}), execution: "succeeded", steps, gaps: [] };
}
describe("Permission Map", () => {
  it("preserves opposing operations and distinct synthetic operation endpoints", () => {
    const m = buildPermissionMap(
      model([
        operation("grant", "Spending delegation", "delegate"),
        operation("revoke", "Delegation revocation"),
        operation("remove", "Authority change"),
      ]),
    );
    expect(m.links).toHaveLength(3);
    expect(m.nodes.filter((n) => n.address === "source")).toHaveLength(1);
    expect(
      m.nodes.find((n) => n.label === "Revocation")?.address,
    ).toBeUndefined();
    expect(
      m.nodes.find((n) => n.label === "Authority removal")?.address,
    ).toBeUndefined();
    expect(m.links[0]?.to).toBe("delegate");
  });
  it("distinguishes failed attempts, later unreached steps and unknown execution", () => {
    const m = model([
      operation("first", "Spending delegation", "delegate"),
      { ...operation("later", "Authority change", "new"), instructionIndex: 2 },
    ]);
    m.execution = "failed";
    m.failure = {
      code: "test",
      explanation: "test",
      instructionIndex: 1,
      logs: [],
      logsIncomplete: true,
    };
    expect(buildPermissionMap(m).links.map((l) => l.state)).toEqual([
      "attempted",
      "not-reached",
    ]);
    m.execution = "unknown";
    expect(
      buildPermissionMap(m).links.every((l) => l.state === "unknown"),
    ).toBe(true);
  });
  it("applies captured Pro flags while leaving Free without personal flags", () => {
    const m = model([operation("grant", "Spending delegation", "delegate")]);
    expect(buildPermissionMap(m).links[0]?.flagged).toBe(false);
    expect(
      buildPermissionMap(m, {
        rules: DEFAULT_RULES,
        status: "flagged",
        checks: [],
      }).links[0]?.flagged,
    ).toBe(true);
    expect(
      buildPermissionMap(m, {
        rules: {
          ...DEFAULT_RULES,
          flagDelegations: false,
          restrictPrograms: true,
          allowedPrograms: ["other"],
        },
        status: "flagged",
        checks: [],
      }).links[0]?.flagged,
    ).toBe(true);
  });
  it("bounds nodes and links and discloses omissions and coverage gaps", () => {
    const m = buildPermissionMap(
      model(
        Array.from({ length: 100 }, (_, i) =>
          operation(`op${i}`, "Spending delegation", `target${i}`),
        ),
      ),
    );
    expect(m.nodes.length).toBeLessThanOrEqual(16);
    expect(m.links.length).toBeLessThanOrEqual(24);
    expect(m.omitted).toBeGreaterThan(0);
    expect(m.incomplete).toBe(true);
    const repeated = buildPermissionMap(
      model(
        Array.from({ length: 100 }, (_, i) =>
          operation(`op${i}`, "Spending delegation", "same"),
        ),
      ),
    );
    expect(repeated.links).toHaveLength(24);
    expect(repeated.omitted).toBe(76);
    expect(buildPermissionMap(model([])).incomplete).toBe(true);
  });
});
