import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { inspectTransaction } from "../apps/web/src/pro/transaction-insights";
import {
  DEFAULT_RULES,
  evaluateRules,
  feeLamports,
  loadRules,
  saveRules,
  validateRules,
} from "../apps/web/src/pro/transaction-rules";

const source = JSON.parse(
  readFileSync("tests/fixtures/settle-tx.json", "utf8"),
).result;
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const noOperations = {
  ...DEFAULT_RULES,
  flagDelegations: false,
  flagAuthorityChanges: false,
};
function operation(op: number, failed = false) {
  const tx = structuredClone(source);
  tx.transaction.message.accountKeys.push(token);
  const data = new Uint8Array(op === 4 ? 9 : 3);
  data[0] = op;
  if (op === 4) new DataView(data.buffer).setBigUint64(1, 1000000n, true);
  else {
    data[1] = 2;
    data[2] = 0;
  }
  tx.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        { programIdIndex: 5, accounts: [1, 0, 0], data: base58.encode(data) },
      ],
    },
  ];
  if (failed) tx.meta.err = { InstructionError: [0, "test"] };
  return tx;
}
describe("local transaction rules", () => {
  it("recognizes ordinary token transfers within the selected permission scope but rejects malformed encodings", () => {
    for (const op of [3, 12, 17]) {
      const tx = structuredClone(source);
      tx.transaction.message.accountKeys.push(token);
      const bytes = new Uint8Array(op === 3 ? 9 : op === 12 ? 10 : 1);
      bytes[0] = op;
      const ix = {
        programIdIndex: 5,
        accounts: [0, 1, 2, 0],
        data: base58.encode(bytes),
      };
      tx.transaction.message.instructions.push(ix);
      expect(evaluateRules(inspectTransaction(tx), DEFAULT_RULES).status).toBe(
        "within-rule",
      );
      ix.data = base58.encode(new Uint8Array([op, 0]));
      expect(evaluateRules(inspectTransaction(tx), DEFAULT_RULES).status).toBe(
        "incomplete",
      );
    }
  });
  it("compares exact SOL fee limits including equality and single-lamport boundaries", () => {
    expect(feeLamports("0.000000001")).toBe(1n);
    const insights = inspectTransaction(source);
    expect(
      evaluateRules(insights, { ...noOperations, maxFeeSol: "0.00001" }).status,
    ).toBe("within-rule");
    expect(
      evaluateRules(insights, { ...noOperations, maxFeeSol: "0.000009999" })
        .status,
    ).toBe("flagged");
    for (const invalid of [
      "-1",
      "1e-3",
      "0.0000000001",
      "0,001",
      "18446744074",
    ])
      expect(() => feeLamports(invalid)).toThrow();
  });
  it("does not turn missing or unsafe fee metadata into compliance", () => {
    const tx = structuredClone(source);
    tx.meta.fee = Number.MAX_SAFE_INTEGER + 1;
    expect(
      evaluateRules(inspectTransaction(tx), { ...noOperations, maxFeeSol: "1" })
        .status,
    ).toBe("incomplete");
  });
  it("flags successful and failed inner delegations and authority changes with accurate execution context", () => {
    for (const op of [4, 6]) {
      const report = evaluateRules(
        inspectTransaction(operation(op)),
        DEFAULT_RULES,
      );
      expect(report.status).toBe("flagged");
      expect(
        report.checks.some((c) =>
          c.explanation.includes("successful execution"),
        ),
      ).toBe(true);
      const failed = evaluateRules(
        inspectTransaction(operation(op, true)),
        DEFAULT_RULES,
      );
      expect(failed.status).toBe("flagged");
      expect(
        failed.checks.some((c) => c.explanation.includes("Attempted only")),
      ).toBe(true);
    }
  });
  it("keeps absent, malformed or unsupported instruction coverage incomplete", () => {
    for (const mode of ["missing", "malformed", "unsupported", "truncated"]) {
      const tx = structuredClone(source);
      if (mode === "missing") delete tx.meta.innerInstructions;
      if (mode === "malformed")
        tx.transaction.message.instructions.push({ programIdIndex: 9999 });
      if (mode === "unsupported") {
        tx.transaction.message.accountKeys.push(token);
        tx.transaction.message.instructions.push({
          programIdIndex: 5,
          accounts: [0],
          data: base58.encode(new Uint8Array([255])),
        });
      }
      if (mode === "truncated")
        tx.transaction.message.instructions = Array(2001).fill(
          tx.transaction.message.instructions[0],
        );
      expect(evaluateRules(inspectTransaction(tx), DEFAULT_RULES).status).toBe(
        "incomplete",
      );
    }
  });
  it("uses referenced programs, including inner and loaded-address programs, without assessing reputation", () => {
    const tx = operation(4);
    tx.meta.loadedAddresses = { writable: [token], readonly: [] };
    tx.transaction.message.accountKeys.pop();
    const insights = inspectTransaction(tx);
    const report = evaluateRules(insights, {
      ...noOperations,
      restrictPrograms: true,
      allowedPrograms: inspectTransaction(source).programs,
    });
    expect(report.status).toBe("flagged");
    expect(report.checks[0]?.explanation).toContain(token);
    expect(
      evaluateRules(insights, {
        ...noOperations,
        restrictPrograms: true,
        allowedPrograms: insights.programs,
      }).status,
    ).toBe("within-rule");
    delete tx.meta.innerInstructions;
    expect(
      evaluateRules(inspectTransaction(tx), {
        ...noOperations,
        restrictPrograms: true,
        allowedPrograms: insights.programs,
      }).status,
    ).toBe("incomplete");
  });
  it("stores per-wallet preferences, validates local inputs and snapshots rule settings", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    saveRules("alice", { ...DEFAULT_RULES, maxFeeSol: "0.001" }, storage);
    expect(loadRules("alice", storage).rules.maxFeeSol).toBe("0.001");
    expect(loadRules("bob", storage).saved).toBe(false);
    const rules = { ...DEFAULT_RULES, maxFeeSol: "0.001" };
    const report = evaluateRules(inspectTransaction(source), rules);
    rules.maxFeeSol = "1";
    expect(report.rules.maxFeeSol).toBe("0.001");
    expect(loadRules("alice", { getItem: () => "{}" }).notice).toContain(
      "could not be loaded",
    );
    expect(() =>
      validateRules({ ...DEFAULT_RULES, restrictPrograms: true }),
    ).toThrow();
    expect(() =>
      validateRules({ ...DEFAULT_RULES, allowedPrograms: ["not-an-address"] }),
    ).toThrow();
    expect(evaluateRules(inspectTransaction(source), noOperations).status).toBe(
      "not-configured",
    );
  });
});
