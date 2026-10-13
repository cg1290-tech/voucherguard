import type { XRayModel, XRayStep } from "./model";

/** Direct references only: ownership and arbitrary program effects remain unknown. */
export function involvesAccount(step: XRayStep, account: string): boolean {
  return (
    !!account &&
    (step.from === account ||
      step.to === account ||
      !!step.accountAddresses?.includes(account))
  );
}

export function focusAccounts(model: XRayModel): string[] {
  return [
    ...new Set(
      [
        ...model.steps.flatMap((step) => [
          step.from,
          step.to,
          ...(step.accountAddresses ?? []),
        ]),
        ...model.insights.balanceChanges.map((change) => change.account),
      ].filter((value): value is string => !!value),
    ),
  ];
}
