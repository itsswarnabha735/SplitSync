import { SplitType } from "./models";

export type SplitPair = [participantId: string, amount: number];

export interface SplitResult {
  ok: boolean;
  error?: string;
  splits: SplitPair[];
}

/**
 * Builds the embedded split map for an expense. Ported from the rounding /
 * validation logic in `SplitSyncViewModel.addExpense` /
 * `addAdHocExpense`. `participantLabel` lets callers tailor error copy
 * ("member" for groups, "participant" for ad-hoc).
 */
export function buildSplits(params: {
  splitType: SplitType;
  amount: number;
  equalParticipantIds: string[];
  exactDistribution: Record<string, number>;
  participantLabel?: string;
}): SplitResult {
  const {
    splitType,
    amount,
    equalParticipantIds,
    exactDistribution,
    participantLabel = "member",
  } = params;

  const splits: SplitPair[] = [];

  if (splitType === "EQUAL") {
    if (equalParticipantIds.length === 0) {
      return {
        ok: false,
        error: `Please select at least one ${participantLabel} to split with.`,
        splits: [],
      };
    }
    const splitAmount =
      Math.round((amount / equalParticipantIds.length) * 100) / 100;
    let remainingDiff = amount - splitAmount * equalParticipantIds.length;
    for (const id of equalParticipantIds) {
      let adjustment = 0;
      if (remainingDiff > 0.01) {
        remainingDiff -= 0.01;
        adjustment = 0.01;
      } else if (remainingDiff < -0.01) {
        remainingDiff += 0.01;
        adjustment = -0.01;
      }
      splits.push([id, roundCents(splitAmount + adjustment)]);
    }
    return { ok: true, splits };
  }

  // EXACT
  const sum = Object.values(exactDistribution).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - amount) > 0.02) {
    return {
      ok: false,
      error: `Sum of split amounts ($${sum.toFixed(
        2
      )}) must equal total amount ($${amount.toFixed(2)}).`,
      splits: [],
    };
  }
  for (const [id, custom] of Object.entries(exactDistribution)) {
    if (custom > 0) splits.push([id, custom]);
  }
  if (splits.length === 0) {
    return {
      ok: false,
      error: "Please specify exact split portions.",
      splits: [],
    };
  }
  return { ok: true, splits };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export function splitsToMap(splits: SplitPair[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [id, amount] of splits) map[id] = amount;
  return map;
}
