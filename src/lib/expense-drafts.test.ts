import { describe, expect, it } from "vitest";

import {
  buildDuplicateFingerprint,
  buildSplitsFromDraft,
  findDuplicateExpenseCandidates,
  validateExpenseDraft,
  type ExpenseDraft,
} from "./expense-drafts";

const baseDraft: ExpenseDraft = {
  id: "draft-1",
  context: "group",
  status: "ready",
  source: "manual",
  description: "Dinner",
  amount: 1200,
  currency: "INR",
  paidById: "u1",
  date: "2026-06-20",
  category: "food-dining",
  splitMethod: "EQUAL",
  participants: {
    u1: { included: true },
    u2: { included: true },
    u3: { included: false },
  },
  warnings: [],
  fieldConfidence: {},
  fieldSource: {},
};

describe("expense draft helpers", () => {
  it("builds equal splits from selected participants", () => {
    const result = buildSplitsFromDraft(baseDraft);

    expect(result.ok).toBe(true);
    expect(result.persistedSplitType).toBe("EQUAL");
    expect(result.splits).toEqual([
      ["u1", 600],
      ["u2", 600],
    ]);
  });

  it("converts shares to exact persisted splits", () => {
    const result = buildSplitsFromDraft(
      {
        ...baseDraft,
        amount: 90,
        splitMethod: "SHARES",
        participants: {
          u1: { included: true },
          u2: { included: true },
        },
      },
      { shareInputs: { u1: "2", u2: "1" } }
    );

    expect(result.ok).toBe(true);
    expect(result.persistedSplitType).toBe("EXACT");
    expect(result.splits).toEqual([
      ["u1", 60],
      ["u2", 30],
    ]);
  });

  it("validates percent splits total 100", () => {
    const result = buildSplitsFromDraft(
      { ...baseDraft, splitMethod: "PERCENT" },
      { percentInputs: { u1: "50", u2: "30" } }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("100%");
  });

  it("blocks participant review and money-movement warnings", () => {
    const splitResult = buildSplitsFromDraft(baseDraft);
    const warnings = validateExpenseDraft({
      draft: {
        ...baseDraft,
        warnings: [
          {
            code: "money-movement",
            field: "category",
            message: "Looks like a transfer.",
            blocking: true,
          },
        ],
      },
      splitResult,
      requireParticipantReview: true,
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      "participant-review",
      "money-movement",
    ]);
  });

  it("finds hard duplicate candidates", () => {
    const fingerprint = buildDuplicateFingerprint({
      date: "2026-06-20",
      description: "Dinner",
      amount: 1200,
      currency: "INR",
    });
    const candidates = findDuplicateExpenseCandidates({
      draft: baseDraft,
      transactionFingerprint: fingerprint,
      existingExpenses: [
        {
          id: "expense-1",
          description: "Dinner",
          amount: 1200,
          currency: "INR",
          timestamp: new Date("2026-06-20T10:00:00").getTime(),
          paidById: "u1",
          splits: { u1: 600, u2: 600 },
          transactionFingerprint: fingerprint,
        },
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].strength).toBe("hard");
  });
});
