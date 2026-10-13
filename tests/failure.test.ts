import { describe, expect, it } from "vitest";
import { explainFailure } from "../apps/web/src/xray/failure";

describe("failure evidence", () => {
  it("explains runtime instruction errors with a validated top-level index", () => {
    const f = explainFailure(
      { err: { InstructionError: [1, "InsufficientFunds"] }, logMessages: [] },
      3,
    );
    expect(f?.instructionIndex).toBe(1);
    expect(f?.explanation).toContain("account did not have enough funds");
    expect(
      explainFailure(
        { err: { InstructionError: [1, "ComputationalBudgetExceeded"] } },
        3,
      )?.explanation,
    ).toContain("compute budget");
    for (const index of [-1, 3, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        explainFailure(
          { err: { InstructionError: [index, "InsufficientFunds"] } },
          3,
        )?.instructionIndex,
      ).toBeUndefined();
    }
  });
  it("does not guess custom codes, arbitrary strings or transaction-wide instruction meanings", () => {
    const f = explainFailure(
      { err: { InstructionError: [0, { Custom: 6001 }] } },
      1,
    );
    expect(f?.code).toBe("Custom 6001 (0x1771)");
    expect(f?.explanation).toContain("meaning is not decoded");
    for (const reason of [
      "constructor",
      "toString",
      "__proto__",
      "FakeSlippage",
    ]) {
      expect(
        explainFailure({ err: { InstructionError: [0, reason] } }, 1)
          ?.explanation,
      ).toContain("not recognized");
    }
    expect(
      explainFailure({ err: "InsufficientFunds" }, 1)?.explanation,
    ).toContain("not recognized");
    expect(
      explainFailure({ err: "InsufficientFundsForFee" }, 1)?.explanation,
    ).toContain("pay its fee");
    expect(
      explainFailure({ err: { InstructionError: [0, { Custom: -1 }] } }, 1)
        ?.code,
    ).toBe("Unrecognized transaction error");
  });
  it("has no diagnosis for successful or unknown execution and keeps missing evidence explicit", () => {
    expect(explainFailure({ err: null }, 1)).toBeUndefined();
    expect(explainFailure({}, 1)).toBeUndefined();
    const f = explainFailure({ err: { Unexpected: {} }, logMessages: null }, 1);
    expect(f?.instructionIndex).toBeUndefined();
    expect(f?.logsIncomplete).toBe(true);
  });
  it("bounds untrusted diagnostic logs and preserves literal content without interpreting it", () => {
    const f = explainFailure(
      { err: "Unknown", logMessages: Array(200).fill("x".repeat(900)) },
      1,
    );
    expect(f?.logs.length).toBeLessThanOrEqual(80);
    expect(f?.logs.every((line) => line.length <= 512)).toBe(true);
    expect(f?.logs.join("").length).toBeLessThanOrEqual(12000);
    expect(f?.logsIncomplete).toBe(true);
    const html = "<script>alert('not evidence')</script>";
    expect(
      explainFailure({ err: "Unknown", logMessages: [html, 5] }, 1)?.logs,
    ).toEqual([html]);
    expect(
      explainFailure({ err: "Unknown", logMessages: [html, 5] }, 1)
        ?.logsIncomplete,
    ).toBe(true);
  });
});
