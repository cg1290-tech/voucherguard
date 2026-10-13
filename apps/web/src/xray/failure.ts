export interface FailureEvidence {
  code: string;
  explanation: string;
  instructionIndex?: number;
  logs: string[];
  logsIncomplete: boolean;
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
// Runtime instruction variants; custom program codes are never guessed.
// https://github.com/anza-xyz/solana-sdk/blob/master/instruction-error/src/lib.rs
const instructionReasons: Record<string, string> = {
  InsufficientFunds:
    "An account did not have enough funds to complete this instruction.",
  ComputationalBudgetExceeded: "Execution exceeded its compute budget.",
  MissingRequiredSignature:
    "The instruction required a signature that was missing.",
  InvalidInstructionData: "The program rejected the instruction data.",
  InvalidAccountData: "The program rejected an account's data.",
  IncorrectProgramId:
    "An account did not have the program ID expected by the instruction.",
  AccountAlreadyInitialized:
    "The instruction tried to initialize an account that was already initialized.",
  UninitializedAccount: "The instruction required an initialized account.",
  IncorrectAuthority: "The instruction received an incorrect authority.",
  PrivilegeEscalation:
    "A nested program call requested signer or write access it did not have.",
  ProgramFailedToComplete:
    "The program did not finish execution. The error alone does not establish the underlying cause.",
  ArithmeticOverflow:
    "A program calculation exceeded its allowed numeric range.",
};
export function explainFailure(
  metaValue: unknown,
  instructionCount: number,
): FailureEvidence | undefined {
  const meta = record(metaValue);
  if (!("err" in meta) || meta.err === null) return undefined;
  const pair = record(meta.err).InstructionError;
  let code = "Unrecognized transaction error";
  let explanation =
    "The recorded error is not recognized. No specific cause is inferred.";
  let instructionIndex: number | undefined;
  if (Array.isArray(pair) && pair.length === 2) {
    const [index, reason] = pair;
    if (
      typeof index === "number" &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < instructionCount
    )
      instructionIndex = index;
    if (typeof reason === "string" && reason.length <= 120) {
      code = reason;
      if (Object.hasOwn(instructionReasons, reason))
        explanation = instructionReasons[reason] ?? explanation;
    } else {
      const custom = record(reason).Custom;
      if (
        typeof custom === "number" &&
        Number.isInteger(custom) &&
        custom >= 0 &&
        custom <= 0xffffffff
      ) {
        code = `Custom ${custom} (0x${custom.toString(16)})`;
        explanation =
          "This is a program-specific error code. Its meaning is not decoded; it must not be assumed to mean slippage or insufficient funds.";
      }
    }
  } else if (typeof meta.err === "string" && meta.err.length <= 120) {
    code = meta.err;
    // Transaction-wide errors have a separate meaning from instruction errors.
    if (meta.err === "InsufficientFundsForFee")
      explanation =
        "The transaction reported insufficient funds to pay its fee.";
  }
  const source = meta.logMessages;
  const logs: string[] = [];
  let logsIncomplete = !Array.isArray(source);
  let remaining = 12000;
  if (Array.isArray(source)) {
    logsIncomplete = source.length > 80;
    for (const line of source.slice(-80)) {
      if (typeof line !== "string") {
        logsIncomplete = true;
        continue;
      }
      const limit = Math.min(512, remaining);
      if (limit <= 0) {
        logsIncomplete = true;
        break;
      }
      logs.push(line.slice(0, limit));
      remaining -= Math.min(line.length, limit);
      if (line.length > limit) logsIncomplete = true;
    }
  }
  const result: FailureEvidence = { code, explanation, logs, logsIncomplete };
  if (instructionIndex !== undefined)
    result.instructionIndex = instructionIndex;
  return result;
}
