import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  displayUnits,
  inspectTransaction,
} from "../apps/web/src/pro/transaction-insights";

const source = JSON.parse(
  readFileSync("tests/fixtures/settle-tx.json", "utf8"),
).result;
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const key = (n: number) => base58.encode(new Uint8Array(32).fill(n));
function tx() {
  const value = structuredClone(source);
  value.transaction.message.accountKeys = [key(1), key(2), key(3), token];
  value.transaction.message.instructions = [];
  value.meta.preBalances = [100000, 1, 1, 1];
  value.meta.postBalances = [90000, 1, 1, 1];
  return value;
}
function data(op: number, amount: bigint, checked = false) {
  const b = new Uint8Array(checked ? 10 : 9);
  b[0] = op;
  new DataView(b.buffer).setBigUint64(1, amount, true);
  if (checked) b[9] = 6;
  return base58.encode(b);
}
describe("automatic single-transaction Pro insights", () => {
  it("shows exact costs and payer deltas from real settlement metadata", () => {
    const result = inspectTransaction(source);
    expect(result.feeLamports).toBe("10000");
    expect(result.feePayerNetLamports).toBe("-10000");
    expect(displayUnits("-10000", 9)).toBe("-0.00001");
    expect(result.innerInstructionCount).toBe(0);
    expect(result.solBalancesComplete).toBe(true);
    expect(result.tokenBalancesComplete).toBe(true);
  });
  it("detects inner spending approvals and checked allowance precision", () => {
    const value = tx();
    value.meta.innerInstructions = [
      {
        index: 0,
        instructions: [
          {
            programIdIndex: 3,
            accounts: [0, 1, 2, 0],
            data: data(4, 18446744073709551615n),
          },
          {
            programIdIndex: 3,
            accounts: [0, 1, 2, 0],
            data: data(13, 1234567n, true),
          },
        ],
      },
    ];
    const result = inspectTransaction(value);
    expect(result.permissionEvents).toHaveLength(2);
    expect(result.permissionEvents[0]?.details).toContain(
      "18446744073709551615",
    );
    expect(result.permissionEvents[1]?.details).toContain("1.234567 tokens");
    expect(result.permissionEvents[0]?.position).toBe("Inner 0.1");
  });
  it("resolves address table writable then readonly accounts", () => {
    const value = tx();
    value.meta.loadedAddresses = { writable: [key(4)], readonly: [key(5)] };
    value.meta.preBalances.push(20, 30);
    value.meta.postBalances.push(19, 31);
    value.transaction.message.instructions = [
      { programIdIndex: 3, accounts: [4, 5, 0], data: data(4, 1n) },
    ];
    const result = inspectTransaction(value);
    expect(result.permissionEvents[0]?.account).toBe(key(4));
    expect(result.permissionEvents[0]?.details).toContain(key(5));
    expect(
      result.balanceChanges.find((c) => c.account === key(5))?.change,
    ).toBe("1");
  });
  it("flags authority changes, closures, burns, freeze and revocation distinctly", () => {
    const value = tx();
    const authority = new Uint8Array(35);
    authority.set([6, 2, 1]);
    authority.set(new Uint8Array(32).fill(9), 3);
    value.transaction.message.instructions = [
      {
        programIdIndex: 3,
        accounts: [0, 1, 2],
        data: base58.encode(authority),
      },
      ...[9, 10, 5].map((op) => ({
        programIdIndex: 3,
        accounts: [0, 1, 2],
        data: base58.encode(new Uint8Array([op])),
      })),
      { programIdIndex: 3, accounts: [0, 1, 2], data: data(8, 10n) },
    ];
    const result = inspectTransaction(value);
    expect(result.permissionEvents.map((e) => e.action)).toEqual([
      "Authority change",
      "Account closure",
      "Account freeze",
      "Delegation revocation",
      "Token burn",
    ]);
    expect(result.permissionEvents[0]?.details).toContain(key(9));
  });
  it("never claims failed authorization attempts were applied", () => {
    const value = tx();
    value.meta.err = { InstructionError: [1, "test"] };
    value.transaction.message.instructions = [
      { programIdIndex: 3, accounts: [0, 1, 2], data: data(4, 10n) },
    ];
    const result = inspectTransaction(value);
    expect(result.success).toBe(false);
    expect(result.permissionEvents[0]?.applied).toBe(false);
    expect(result.warnings[0]).toContain("not applied");
  });
  it("keeps unsafe integers, absent CPI traces and unknown extensions incomplete", () => {
    const value = tx();
    value.meta.preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
    delete value.meta.innerInstructions;
    value.transaction.message.instructions = [
      {
        programIdIndex: 3,
        accounts: [0, 1, 2],
        data: base58.encode(new Uint8Array([42])),
      },
    ];
    const result = inspectTransaction(value);
    expect(result.solBalancesComplete).toBe(false);
    expect(result.feePayerNetLamports).toBeUndefined();
    expect(result.coverage.join(" ")).toContain("trace unavailable");
    expect(result.coverage.join(" ")).toContain("not decoded");
  });
  it("uses exact token amounts and distinguishes missing from zero snapshots", () => {
    const value = tx();
    const balance = (amount: string) => ({
      accountIndex: 1,
      mint: key(7),
      owner: key(8),
      uiTokenAmount: { amount, decimals: 6 },
    });
    value.meta.preTokenBalances = [balance("18446744073709551615")];
    value.meta.postTokenBalances = [balance("0")];
    let result = inspectTransaction(value);
    expect(result.balanceChanges.find((c) => c.asset === key(7))?.change).toBe(
      "-18446744073709551615",
    );
    value.meta.preTokenBalances = [];
    result = inspectTransaction(value);
    expect(result.tokenBalancesComplete).toBe(false);
    expect(
      result.balanceChanges.find((c) => c.asset === key(7)),
    ).toBeUndefined();
  });
  it("flags token ownership changes even with an unchanged balance", () => {
    const value = tx();
    const b = {
      accountIndex: 1,
      mint: key(7),
      owner: key(8),
      uiTokenAmount: { amount: "1", decimals: 6 },
    };
    value.meta.preTokenBalances = [b];
    value.meta.postTokenBalances = [{ ...b, owner: key(9) }];
    expect(inspectTransaction(value).warnings.join(" ")).toContain(
      "owner changed",
    );
  });
  it("detects Token-2022 basic approvals and reports malformed instructions as undecoded", () => {
    const value = tx();
    value.transaction.message.accountKeys[3] =
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
    value.transaction.message.instructions = [
      { programIdIndex: 3, accounts: [0, 1, 2], data: data(4, 1n) },
      {
        programIdIndex: 3,
        accounts: [0],
        data: base58.encode(new Uint8Array([4])),
      },
    ];
    const result = inspectTransaction(value);
    expect(result.permissionEvents).toHaveLength(1);
    expect(result.coverage.join(" ")).toContain("not decoded");
  });
});
