import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  draftFromPolicy,
  exportBatch,
  parseBatch,
  readLibrary,
  runBatch,
  tokenBaseUnits,
} from "../apps/web/src/pro/workspace";

const valid = JSON.parse(readFileSync("examples/valid.json", "utf8"));
describe("Pro workspace", () => {
  it("converts token amounts exactly and rejects precision loss and overflow", () => {
    expect(tokenBaseUnits("5.123456", "6")).toBe("5123456");
    expect(() => tokenBaseUnits("0.0000001", "6")).toThrow();
    expect(() => tokenBaseUnits("18446744073709551616", "0")).toThrow();
    expect(() => tokenBaseUnits("-1", "6")).toThrow();
  });
  it("bounds imports and isolates malformed vouchers without silently fixing identity", async () => {
    const docs = parseBatch(JSON.stringify([valid, { protocol: "wrong" }]));
    const original = JSON.stringify(docs);
    const result = await runBatch(docs, {
      ...valid.policy,
      maxCumulativeAmount: "499",
    });
    expect(result[0]?.report?.status).toBe("FAIL");
    expect(
      result[0]?.report?.checks.some((c) => c.code === "AMOUNT_LIMIT"),
    ).toBe(true);
    expect(result[1]?.error).toBeTruthy();
    expect(JSON.stringify(docs)).toBe(original);
    expect(() => parseBatch(JSON.stringify(Array(101).fill(valid)))).toThrow();
    expect(() => parseBatch(" ".repeat(1024 * 1024 + 1))).toThrow();
  });
  it("exports the actual policy, evidence and limitations for a completed run", async () => {
    const result = await runBatch(
      parseBatch(JSON.stringify(valid)),
      valid.policy,
    );
    expect(result[0]?.report?.status).toBe("PASS");
    const exported = JSON.parse(exportBatch(result, valid.policy));
    expect(exported.policy).toEqual(valid.policy);
    expect(exported.results[0].report.evidence.messageHex).toBe(
      valid.message.value,
    );
    expect(exported.limitations.length).toBeGreaterThan(0);
  });
  it("validates saved revisions and imported policy schema", () => {
    expect(draftFromPolicy(valid.policy).expectedChannelId).toBe(
      valid.policy.expectedChannelId.value,
    );
    expect(() => draftFromPolicy({ maxCumulativeAmount: "-1" })).toThrow();
    expect(() =>
      readLibrary(
        JSON.stringify([
          {
            id: "x",
            name: "bad",
            revision: 0,
            savedAt: "now",
            policy: valid.policy,
          },
        ]),
      ),
    ).toThrow();
  });
});
