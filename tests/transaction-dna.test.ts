import { describe, expect, it } from "vitest";
import {
  buildXRay,
  type XRayModel,
  type XRayStep,
} from "../apps/web/src/xray/model";
import {
  buildTransactionDNA,
  compareTransactionDNA,
  savedTransactionDNA,
} from "../apps/web/src/xray/transaction-dna";

const step = (position: string, amount = "18446744073709551615"): XRayStep => ({
  id: position,
  position,
  program: "program",
  kind: "money",
  label: "Transfer",
  details: "evidence",
  from: "source",
  to: "destination",
  amount,
  decimals: 9,
  asset: "SOL",
  instructionIndex: 0,
});
function model(steps: XRayStep[]): XRayModel {
  const m = buildXRay({});
  return {
    ...m,
    execution: "succeeded",
    steps,
    gaps: [],
    insights: {
      ...m.insights,
      programs: ["program"],
      programsComplete: true,
      coverage: [],
    },
  };
}
function dna(m: unknown) {
  const d = buildTransactionDNA(m);
  if (!d) throw Error("Missing DNA");
  return d;
}
describe("Transaction DNA evidence scope", () => {
  it("is deterministic, retains exact u64 quantities and ignores display text, signatures, fees and net balances", () => {
    const original = model([step("1")]);
    const snapshot = structuredClone(original);
    const a = dna(original);
    const b = structuredClone(original);
    b.steps[0] = {
      ...step("renamed-position"),
      label: "Another label",
      details: "Other copy",
    };
    b.insights.feeLamports = "900000";
    b.insights.balanceChanges = [
      { account: "source", asset: "SOL", change: "-100", decimals: 9 },
    ];
    expect(dna(b).fingerprint).toBe(a.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(a.operations[0]?.amount).toBe("18446744073709551615");
    expect(original).toEqual(snapshot);
    b.steps[0].amount = "18446744073709551614";
    const diff = compareTransactionDNA(a, dna(b));
    expect(diff.changed).toHaveLength(1);
    expect(diff.sameFingerprint).toBe(false);
    expect(diff.changed[0]?.before.amount).toBe("18446744073709551615");
  });
  it("reserves exact duplicate matches before pairing changed quantities and detects reordering", () => {
    const a = dna(model([step("1", "1"), step("2", "2")]));
    const b = dna(model([step("1", "3"), step("2", "1")]));
    const diff = compareTransactionDNA(a, b);
    expect(diff.matching).toBe(1);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.before.amount).toBe("2");
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    const first = { ...step("1"), to: "A" },
      second = { ...step("2"), to: "B" };
    const ordered = dna(model([first, second]));
    const reversed = dna(
      model([
        { ...second, position: "1" },
        { ...first, position: "2" },
      ]),
    );
    expect(compareTransactionDNA(ordered, reversed).sequenceChanged).toBe(true);
    expect(compareTransactionDNA(ordered, reversed).matching).toBe(2);
    expect(ordered.fingerprint).not.toBe(reversed.fingerprint);
  });
  it("treats changed delegates as added/removed operations and distinguishes failed and unreached steps", () => {
    const approval: XRayStep = {
      ...step("1", "100"),
      kind: "permission",
      permissionAction: "Spending delegation",
      to: "old-delegate",
    };
    const a = dna(model([approval]));
    const b = model([{ ...approval, to: "new-delegate" }]);
    b.insights.programs.push("new-program");
    const diff = compareTransactionDNA(a, dna(b));
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed).toHaveLength(0);
    expect(diff.addedPrograms).toEqual(["new-program"]);
    const failed = model([approval, { ...step("2"), instructionIndex: 2 }]);
    failed.execution = "failed";
    failed.failure = {
      code: "test",
      explanation: "test",
      instructionIndex: 0,
      logs: [],
      logsIncomplete: false,
    };
    expect(dna(failed).operations.map((op) => op.state)).toEqual([
      "attempted",
      "not-reached",
    ]);
    expect(compareTransactionDNA(a, dna(failed)).changed[0]?.after.state).toBe(
      "attempted",
    );
  });
  it("retains opaque instruction data/account references and missing coverage without inferring behavior", () => {
    const unknown: XRayStep = {
      ...step("1"),
      kind: "unknown",
      instructionData: "abc",
      accountAddresses: ["A", "B"],
    };
    const a = model([unknown]);
    a.gaps = ["Trace missing"];
    const b = model([{ ...unknown, instructionData: "abcd" }]);
    expect(dna(a).operations[0]?.data).toBe("abc");
    expect(dna(a).gaps).toContain("Trace missing");
    expect(compareTransactionDNA(dna(a), dna(b)).coverageIncomplete).toBe(true);
    expect(compareTransactionDNA(dna(a), dna(b)).added).toHaveLength(1);
    b.steps[0] = { ...unknown, accountAddresses: ["B", "A"] };
    expect(dna(b).fingerprint).not.toBe(dna(a).fingerprint);
  });
  it("rejects malformed or oversized saved models and supports existing evidence without a schema migration", () => {
    expect(savedTransactionDNA("not json")).toBeUndefined();
    expect(savedTransactionDNA(JSON.stringify({ review: {} }))).toBeUndefined();
    expect(
      savedTransactionDNA(
        JSON.stringify({ review: { xray: model([step("1")]) } }),
      )?.operations,
    ).toHaveLength(1);
    expect(buildTransactionDNA(model([step("1"), step("1")]))).toBeUndefined();
    expect(
      buildTransactionDNA(model([step("1", "18446744073709551616")])),
    ).toBeUndefined();
    expect(buildTransactionDNA(model([step("1", "-1")]))).toBeUndefined();
    expect(
      buildTransactionDNA({
        ...model([]),
        steps: Array.from({ length: 201 }, (_, i) => step(String(i))),
      }),
    ).toBeUndefined();
    expect(
      buildTransactionDNA({ ...model([]), steps: [null] }),
    ).toBeUndefined();
  });
});
