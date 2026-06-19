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
    const totalCents = toCents(amount);
    const baseCents = Math.floor(totalCents / equalParticipantIds.length);
    const remainderCents = totalCents - baseCents * equalParticipantIds.length;
    for (const [index, id] of equalParticipantIds.entries()) {
      const cents = baseCents + (index < remainderCents ? 1 : 0);
      splits.push([id, cents / 100]);
    }
    return { ok: true, splits };
  }

  // EXACT
  const exactEntries = Object.entries(exactDistribution);
  if (exactEntries.some(([, custom]) => !Number.isFinite(custom) || custom < 0)) {
    return {
      ok: false,
      error: "Exact split portions cannot be negative.",
      splits: [],
    };
  }
  const normalized = exactEntries.map(([id, custom]) => [id, toCents(custom)] as const);
  const sumCents = normalized.reduce((a, [, cents]) => a + cents, 0);
  const totalCents = toCents(amount);
  if (sumCents !== totalCents) {
    return {
      ok: false,
      error: `Sum of split amounts ($${(sumCents / 100).toFixed(
        2
      )}) must equal total amount ($${(totalCents / 100).toFixed(2)}).`,
      splits: [],
    };
  }
  for (const [id, cents] of normalized) {
    if (cents > 0) splits.push([id, cents / 100]);
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

function toCents(n: number): number {
  return Math.round(n * 100);
}

export function splitsToMap(splits: SplitPair[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [id, amount] of splits) map[id] = amount;
  return map;
}
