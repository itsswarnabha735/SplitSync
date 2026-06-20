import { SplitType } from "./models";
import { formatMoney } from "./currency";

export type SplitPair = [participantId: string, amount: number];
export type DraftSplitMethod = SplitType | "SHARES" | "PERCENT" | "ADJUSTMENT";

export interface SplitResult {
  ok: boolean;
  error?: string;
  splits: SplitPair[];
}

export interface AdvancedSplitParams {
  splitMethod: DraftSplitMethod;
  amount: number;
  equalParticipantIds: string[];
  exactDistribution: Record<string, number>;
  shareDistribution?: Record<string, number>;
  percentDistribution?: Record<string, number>;
  adjustmentDistribution?: Record<string, number>;
  participantLabel?: string;
  currency?: string;
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
  currency?: string;
}): SplitResult {
  const {
    splitType,
    amount,
    equalParticipantIds,
    exactDistribution,
    participantLabel = "member",
    currency = "USD",
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
      error: `Sum of split amounts (${formatMoney(
        sumCents / 100,
        currency
      )}) must equal total amount (${formatMoney(totalCents / 100, currency)}).`,
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

export function buildSplitsForMethod(params: AdvancedSplitParams): SplitResult & {
  persistedSplitType: SplitType;
} {
  const participantLabel = params.participantLabel ?? "member";
  const currency = params.currency ?? "USD";

  if (params.splitMethod === "EQUAL") {
    return {
      ...buildSplits({
        splitType: "EQUAL",
        amount: params.amount,
        equalParticipantIds: params.equalParticipantIds,
        exactDistribution: {},
        participantLabel,
        currency,
      }),
      persistedSplitType: "EQUAL",
    };
  }

  if (params.splitMethod === "EXACT") {
    return {
      ...buildSplits({
        splitType: "EXACT",
        amount: params.amount,
        equalParticipantIds: [],
        exactDistribution: params.exactDistribution,
        participantLabel,
        currency,
      }),
      persistedSplitType: "EXACT",
    };
  }

  if (params.splitMethod === "SHARES") {
    const shareEntries = Object.entries(params.shareDistribution ?? {}).filter(
      ([id, share]) =>
        params.equalParticipantIds.includes(id) && Number.isFinite(share) && share > 0
    );
    const totalShares = shareEntries.reduce((sum, [, share]) => sum + share, 0);
    if (totalShares <= 0) {
      return {
        ok: false,
        error: `Enter at least one positive share for a selected ${participantLabel}.`,
        splits: [],
        persistedSplitType: "EXACT",
      };
    }
    return {
      ok: true,
      splits: allocateCents(
        params.amount,
        shareEntries.map(([id, share]) => [id, share / totalShares])
      ),
      persistedSplitType: "EXACT",
    };
  }

  if (params.splitMethod === "PERCENT") {
    const percentEntries = Object.entries(params.percentDistribution ?? {}).filter(
      ([id, percent]) =>
        params.equalParticipantIds.includes(id) &&
        Number.isFinite(percent) &&
        percent > 0
    );
    const totalPercentCents = percentEntries.reduce(
      (sum, [, percent]) => sum + Math.round(percent * 100),
      0
    );
    if (totalPercentCents !== 10000) {
      return {
        ok: false,
        error: `Percent split must total 100%. Current total is ${(
          totalPercentCents / 100
        ).toFixed(2)}%.`,
        splits: [],
        persistedSplitType: "EXACT",
      };
    }
    return {
      ok: true,
      splits: allocateCents(
        params.amount,
        percentEntries.map(([id, percent]) => [id, percent / 100])
      ),
      persistedSplitType: "EXACT",
    };
  }

  const base = buildSplits({
    splitType: "EQUAL",
    amount: params.amount,
    equalParticipantIds: params.equalParticipantIds,
    exactDistribution: {},
    participantLabel,
    currency,
  });
  if (!base.ok) return { ...base, persistedSplitType: "EXACT" };

  const adjustments = params.adjustmentDistribution ?? {};
  const adjusted = new Map(base.splits.map(([id, share]) => [id, toCents(share)]));
  for (const [id, adjustment] of Object.entries(adjustments)) {
    if (!params.equalParticipantIds.includes(id)) continue;
    if (!Number.isFinite(adjustment)) continue;
    adjusted.set(id, (adjusted.get(id) ?? 0) + toCents(adjustment));
  }

  if (Array.from(adjusted.values()).some((cents) => cents < 0)) {
    return {
      ok: false,
      error: "Adjusted split portions cannot go below zero.",
      splits: [],
      persistedSplitType: "EXACT",
    };
  }

  const totalCents = toCents(params.amount);
  const adjustedSum = Array.from(adjusted.values()).reduce((sum, cents) => sum + cents, 0);
  if (adjustedSum !== totalCents) {
    return {
      ok: false,
      error: `Adjustments must keep the split total at ${formatMoney(
        params.amount,
        currency
      )}. Current total is ${formatMoney(adjustedSum / 100, currency)}.`,
      splits: [],
      persistedSplitType: "EXACT",
    };
  }

  return {
    ok: true,
    splits: Array.from(adjusted.entries())
      .filter(([, cents]) => cents > 0)
      .map(([id, cents]) => [id, cents / 100]),
    persistedSplitType: "EXACT",
  };
}

function toCents(n: number): number {
  return Math.round(n * 100);
}

function allocateCents(amount: number, weightedIds: Array<[string, number]>): SplitPair[] {
  const totalCents = toCents(amount);
  const raw = weightedIds.map(([id, ratio]) => {
    const exact = totalCents * ratio;
    return {
      id,
      cents: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let assigned = raw.reduce((sum, entry) => sum + entry.cents, 0);
  for (const entry of [...raw].sort((a, b) => b.remainder - a.remainder)) {
    if (assigned >= totalCents) break;
    entry.cents += 1;
    assigned += 1;
  }
  return raw
    .filter((entry) => entry.cents > 0)
    .map((entry) => [entry.id, entry.cents / 100]);
}

export function splitsToMap(splits: SplitPair[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [id, amount] of splits) map[id] = amount;
  return map;
}
