import { base58 } from "@scure/base";
import { describe, expect, it, vi } from "vitest";
import { buildXRay, loadXRay } from "../apps/web/src/xray/model";

import {
  focusAccounts,
  involvesAccount,
} from "../apps/web/src/xray/wallet-focus";

const key = (n: number) => base58.encode(new Uint8Array(32).fill(n));
const system = "11111111111111111111111111111111";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const signature =
  "4wMpYs4wHJX8ArjcTBqZ9pTV1erxAJiqHbUsHkUq44kb8wELDZtRem3k2ZjYQW4kF99TPXe4HhR8hRHJ29DbAvTa";
function amount(op: number, n: bigint, checked = false) {
  const b = new Uint8Array(checked ? 10 : 9);
  b[0] = op;
  new DataView(b.buffer).setBigUint64(1, n, true);
  if (checked) b[9] = 6;
  return base58.encode(b);
}
function tx() {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setUint32(0, 2, true);
  new DataView(bytes.buffer).setBigUint64(4, 1000000000n, true);
  return {
    slot: 1,
    blockTime: 1900000000,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [key(1), key(2), system, token, key(3)],
        instructions: [
          { programIdIndex: 2, accounts: [0, 1], data: base58.encode(bytes) },
          {
            programIdIndex: 4,
            accounts: [],
            data: base58.encode(new Uint8Array([99])),
          },
        ],
      },
    },
    meta: {
      err: null as unknown,
      fee: 5000,
      preBalances: [100000, 0, 1, 1, 1],
      postBalances: [90000, 10000, 1, 1, 1],
      preTokenBalances: [] as unknown[],
      postTokenBalances: [] as unknown[],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programIdIndex: 3,
              accounts: [0, 1, 0],
              data: amount(4, 1000000n),
            },
          ],
        },
      ],
      loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
    },
  };
}
describe("Transaction X-Ray", () => {
  it("focuses direct endpoints and unknown account references without inferring ownership", () => {
    const model = buildXRay(tx());
    const first = model.steps[0];
    if (!first) throw Error("Missing fixture step");
    expect(involvesAccount(first, key(1))).toBe(true);
    expect(involvesAccount(first, key(2))).toBe(true);
    expect(involvesAccount(first, key(9))).toBe(false);
    expect(involvesAccount(first, "")).toBe(false);
    const unknown = {
      id: "unknown",
      position: "Instruction 9",
      program: key(3),
      label: "Unknown",
      details: "Not decoded",
      kind: "unknown" as const,
      accountAddresses: [key(9)],
    };
    expect(involvesAccount(unknown, key(9))).toBe(true);
    expect(involvesAccount({ ...unknown, accountAddresses: [] }, key(9))).toBe(
      false,
    );
    model.insights.balanceChanges.push({
      account: key(8),
      owner: key(9),
      asset: key(7),
      change: "10",
      decimals: 6,
    });
    const accounts = focusAccounts(model);
    expect(accounts).toContain(key(8));
    expect(accounts).not.toContain(key(9));
    expect(new Set(accounts).size).toBe(accounts.length);
  });
  it("walks top-level and inner instructions in recorded order and keeps unknown programs explicit", () => {
    const m = buildXRay(tx());
    expect(m.steps.map((s) => s.position)).toEqual([
      "Instruction 1",
      "Inner 0.1",
      "Instruction 2",
    ]);
    expect(m.steps.map((s) => s.kind)).toEqual([
      "money",
      "permission",
      "unknown",
    ]);
    expect(m.steps[0]?.amount).toBe("1000000000");
    expect(m.steps[0]?.instructionData).toBeDefined();
    expect(m.steps[0]?.accountAddresses).toEqual([key(1), key(2)]);
    expect(m.steps[1]?.to).toBe(key(2));
  });
  it("decodes exact u64 token amounts and loaded addresses without inferring unknown mint precision", () => {
    const t = tx();
    t.meta.innerInstructions = [];
    t.transaction.message.accountKeys.pop();
    t.meta.loadedAddresses.readonly = [key(3)];
    t.transaction.message.instructions = [
      {
        programIdIndex: 3,
        accounts: [0, 1, 0],
        data: amount(3, 18446744073709551615n),
      },
    ];
    const unknown = buildXRay(t).steps[0];
    expect(unknown?.amount).toBe("18446744073709551615");
    expect(unknown?.decimals).toBeUndefined();
    const balance = {
      accountIndex: 0,
      mint: key(9),
      uiTokenAmount: { amount: "100", decimals: 6 },
    };
    t.meta.preTokenBalances = [balance, { ...balance, accountIndex: 1 }];
    t.meta.postTokenBalances = t.meta.preTokenBalances;
    expect(buildXRay(t).steps[0]?.decimals).toBe(6);
    t.transaction.message.instructions = [
      {
        programIdIndex: 3,
        accounts: [0, 4, 1, 0],
        data: amount(12, 1234567n, true),
      },
    ];
    expect(buildXRay(t).steps[0]?.asset).toBe(key(3));
    expect(buildXRay(t).steps[0]?.to).toBe(key(2));
  });
  it("marks failed and missing execution metadata without inventing applied transfers", () => {
    const t = tx();
    t.meta.err = { InstructionError: [0, "test"] };
    expect(buildXRay(t).execution).toBe("failed");
    expect(buildXRay(t).failure?.instructionIndex).toBe(0);
    expect(buildXRay(t).steps[1]?.instructionIndex).toBe(0);
    const raw = { ...t, meta: { innerInstructions: [] } };
    expect(buildXRay(raw).execution).toBe("unknown");
    expect(buildXRay(raw).gaps.join(" ")).toContain("not established");
  });
  it("preserves unresolved instructions and bounds playback while exposing trace gaps", () => {
    const t = tx();
    const first = t.transaction.message.instructions[0];
    if (!first) throw Error("Missing fixture instruction");
    first.programIdIndex = 9000;
    expect(buildXRay(t).steps[0]?.kind).toBe("unknown");
    t.transaction.message.instructions = Array(250).fill(
      t.transaction.message.instructions[0],
    );
    const m = buildXRay(t);
    expect(m.steps).toHaveLength(200);
    expect(m.gaps.join(" ")).toContain("first 200");
    const missing = { ...tx(), meta: { err: null, innerInstructions: null } };
    expect(buildXRay(missing).gaps.join(" ")).toContain("trace unavailable");
    const duplicate = tx();
    const group = duplicate.meta.innerInstructions[0];
    if (!group) throw Error("Missing fixture group");
    duplicate.meta.innerInstructions.push(group);
    expect(buildXRay(duplicate).gaps.join(" ")).toContain("duplicate");
  });
  it("rejects malformed transfer byte lengths and unresolved token accounts", () => {
    const t = tx();
    t.transaction.message.instructions = [
      { programIdIndex: 3, accounts: [0, 999, 0], data: amount(3, 1n) },
    ];
    expect(buildXRay(t).steps[0]?.kind).toBe("unknown");
    t.transaction.message.instructions = [
      {
        programIdIndex: 2,
        accounts: [0, 1],
        data: base58.encode(new Uint8Array([2, 0, 0, 0])),
      },
    ];
    expect(buildXRay(t).steps[0]?.amount).toBeUndefined();
  });
  it("loads ordinary transactions with one RPC call even when no supported voucher exists", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ result: tx() })),
    );
    const r = await loadXRay(signature, "https://example.test/rpc", fetcher);
    expect(r.xray?.steps).toHaveLength(3);
    expect(r.result.kind).toBe("unsupported");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await loadXRay("bad", "https://example.test/rpc", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
