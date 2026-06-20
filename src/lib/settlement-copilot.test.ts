import { describe, expect, it } from "vitest";

import {
  buildLocalSettlementCopilotResponse,
  validateSettlementCopilotRequest,
  validateSettlementCopilotResponse,
  type SettlementCopilotContext,
} from "./settlement-copilot";

const context: SettlementCopilotContext = {
  title: "Goa Trip",
  surface: "group",
  summary: "Group settlement context.",
  facts: ["Two deterministic payments are pending."],
  debts: [
    {
      id: "m1:m2:INR",
      debtorId: "m1",
      debtorName: "Asha",
      creditorId: "m2",
      creditorName: "Rahul",
      amount: 500,
      currency: "INR",
    },
  ],
  expenses: [
    {
      id: "expense-1",
      description: "Dinner",
      amount: 1000,
      currency: "INR",
    },
  ],
  warnings: [],
};

describe("settlement copilot contract", () => {
  it("sanitizes prompts and removes forbidden context fields", () => {
    const result = validateSettlementCopilotRequest({
      contextType: "group",
      userPrompt:
        "Explain this to test@example.com and +91 98765 43210 for card 4111 1111 1111 1111",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      context: {
        ...context,
        email: "leak@example.com",
        phone: "9876543210",
        rawText: "full statement text",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.userPrompt).toContain("[email]");
    expect(result.request.userPrompt).not.toContain("98765");
    expect(result.request.userPrompt).not.toContain("4111");
    expect(JSON.stringify(result.request.context)).not.toContain("leak");
    expect(JSON.stringify(result.request.context)).not.toContain("full statement");
  });

  it("filters unsupported suggestions and invented entity references", () => {
    const response = validateSettlementCopilotResponse(
      {
        answer: "Rahul is owed based on the deterministic settlement plan.",
        sections: [{ title: "Why", body: "Dinner is the referenced expense." }],
        suggestions: [
          {
            type: "copy-summary",
            title: "Summary",
            body: "Asha pays Rahul INR 500.",
          },
          {
            type: "record-payment",
            title: "Unsafe",
            body: "This should not render.",
          },
        ],
        warnings: [],
        entityRefs: [
          { type: "expense", id: "expense-1", label: "Dinner" },
          { type: "payment", id: "invented-payment", label: "Unknown" },
        ],
        confidence: 1.4,
        requiresReview: false,
      },
      context
    );

    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0].type).toBe("copy-summary");
    expect(response.entityRefs).toEqual([
      { type: "expense", id: "expense-1", label: "Dinner" },
    ]);
    expect(response.confidence).toBe(1);
  });

  it("builds deterministic fallback responses without write actions", () => {
    const validation = validateSettlementCopilotRequest({
      contextType: "group",
      userPrompt: "Write a WhatsApp summary",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      context,
    });
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const response = buildLocalSettlementCopilotResponse(validation.request);
    expect(response.suggestions.some((s) => s.type === "copy-summary")).toBe(
      true
    );
    expect(JSON.stringify(response)).not.toContain("record");
  });
});
