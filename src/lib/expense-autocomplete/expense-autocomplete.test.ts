import { describe, expect, it } from "vitest";

import {
  applyExpenseAutocompleteDraft,
  buildLocalExpenseAutocompleteResponse,
  detectDuplicateLikeWarning,
  validateExpenseAutocompleteRequest,
  validateExpenseAutocompleteResponse,
  type ExpenseAutocompleteRequest,
} from ".";

const request: ExpenseAutocompleteRequest = {
  input: "Uber 920 INR paid by me split with everyone yesterday",
  mode: "group",
  timezone: "Asia/Kolkata",
  today: "2026-06-20",
  defaults: {
    currency: "INR",
    date: "2026-06-20",
    paidById: "me",
    splitType: "EQUAL",
  },
  participants: [
    {
      id: "me",
      name: "You",
      isCurrentUser: true,
      aliases: ["me", "i", "you"],
    },
    { id: "riya", name: "Riya", isCurrentUser: false },
  ],
  supportedCurrencies: ["INR", "USD"],
  recentContext: [],
};

describe("expense autocomplete", () => {
  it("applies high-confidence fields and ignores low-confidence fields", () => {
    const response = validateExpenseAutocompleteResponse(
      {
        draft: {
          description: "Uber",
          amount: 920,
          currency: "USD",
          date: "2026-06-19",
          paidById: "me",
          category: "Transport",
          splitType: "EQUAL",
          equalParticipantIds: ["me", "riya"],
        },
        confidence: {
          description: 0.9,
          amount: 0.94,
          currency: 0.4,
          date: 0.8,
          paidById: 0.9,
          category: 0.86,
          splitType: 0.8,
          equalParticipantIds: 0.88,
        },
        warnings: [],
      },
      request
    );

    const applied = applyExpenseAutocompleteDraft({
      response,
      current: {
        description: "",
        amountStr: "",
        currency: "INR",
        dateStr: "2026-06-20",
        paidBy: "me",
        category: "other",
        splitType: "EQUAL",
      },
      participants: request.participants,
      supportedCurrencies: request.supportedCurrencies,
    });

    expect(applied.fields.description).toBe("Uber");
    expect(applied.fields.amountStr).toBe("920.00");
    expect(applied.fields.currency).toBeUndefined();
    expect(applied.fields.category).toBe("transport");
    expect(applied.fields.equalSelections).toEqual({ me: true, riya: true });
    expect(applied.warnings.some((warning) => warning.field === "currency")).toBe(
      true
    );
  });

  it("rejects unknown participants and unsupported currencies", () => {
    const response = validateExpenseAutocompleteResponse(
      {
        draft: {
          amount: 12,
          currency: "EUR",
          paidById: "unknown",
          equalParticipantIds: ["me", "unknown"],
        },
        confidence: {
          amount: 0.9,
          currency: 0.9,
          paidById: 0.9,
          equalParticipantIds: 0.9,
        },
        warnings: [],
      },
      request
    );

    expect(response.draft.currency).toBeUndefined();
    expect(response.draft.paidById).toBeUndefined();
    expect(response.draft.equalParticipantIds).toEqual(["me"]);
    expect(
      response.warnings.some((warning) => warning.code === "ambiguous-participant")
    ).toBe(true);
  });

  it("detects duplicate-like expenses from recent context", () => {
    const warning = detectDuplicateLikeWarning(
      {
        description: "Swiggy",
        amount: 100,
        currency: "INR",
        date: "2026-01-15",
      },
      [
        {
          description: "swiggy",
          amount: 100,
          currency: "INR",
          paidById: "me",
          splitType: "EQUAL",
          participantIds: ["me", "riya"],
          timestamp: new Date(2026, 0, 15).getTime(),
        },
      ]
    );

    expect(warning?.code).toBe("duplicate-like");
  });

  it("warns when exact splits do not match the total", () => {
    const response = validateExpenseAutocompleteResponse(
      {
        draft: {
          amount: 100,
          splitType: "EXACT",
          exactSplits: { me: 30, riya: 40 },
        },
        confidence: {
          amount: 0.9,
          splitType: 0.9,
          exactSplits: 0.9,
        },
        warnings: [],
      },
      request
    );

    expect(
      response.warnings.some(
        (warning) => warning.code === "exact-split-mismatch"
      )
    ).toBe(true);
  });

  it("locally resolves current user and everyone", () => {
    const response = buildLocalExpenseAutocompleteResponse(request);

    expect(response.draft.amount).toBe(920);
    expect(response.draft.currency).toBe("INR");
    expect(response.draft.date).toBe("2026-06-19");
    expect(response.draft.paidById).toBe("me");
    expect(response.draft.equalParticipantIds).toEqual(["me", "riya"]);
  });

  it("validates request shape and prompt length", () => {
    expect(validateExpenseAutocompleteRequest({ input: "a" }).ok).toBe(false);
    expect(validateExpenseAutocompleteRequest(request).ok).toBe(true);
  });
});
