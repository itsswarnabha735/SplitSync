import { describe, expect, it } from "vitest";

import {
  buildTransactionFingerprint,
  isDuplicateLikeImportRow,
  distributeBySharedExactShares,
  toStatementImportRow,
} from "./import-adapter";
import type { ParsedStatementTransaction } from "./types";

function tx(
  overrides: Partial<ParsedStatementTransaction>
): ParsedStatementTransaction {
  return {
    id: "tx-1",
    date: "2026-01-15",
    vendor: "Swiggy",
    amount: 100,
    type: "debit",
    category: null,
    suggestedCategoryName: "Food & Dining",
    rawLine: "",
    confidence: 0.9,
    selected: true,
    note: "",
    ...overrides,
  };
}

describe("statement import adapter", () => {
  it("selects only expense-like rows by default", () => {
    expect(toStatementImportRow(tx({ type: "debit", amount: 100 })).selected).toBe(
      true
    );
    expect(toStatementImportRow(tx({ type: "fee", amount: 10 })).selected).toBe(
      true
    );
    expect(
      toStatementImportRow(tx({ type: "payment", amount: -100 })).selected
    ).toBe(false);
    expect(
      toStatementImportRow(tx({ type: "refund", amount: -50 })).selectable
    ).toBe(false);
  });

  it("leaves income and transfers unselected by default", () => {
    expect(
      toStatementImportRow(
        tx({ type: "debit", amount: 100, suggestedCategoryName: "Transfers" })
      ).selected
    ).toBe(false);
    expect(
      toStatementImportRow(
        tx({ type: "credit", amount: -100, suggestedCategoryName: "Income" })
      ).selected
    ).toBe(false);
  });

  it("resolves suggested category names to persisted slugs", () => {
    expect(
      toStatementImportRow(tx({ suggestedCategoryName: "Groceries" })).category
    ).toBe("groceries");
    expect(
      toStatementImportRow(tx({ suggestedCategoryName: "unknown" })).category
    ).toBe("other");
  });

  it("distributes exact total shares proportionally per expense", () => {
    const result = distributeBySharedExactShares(10, [
      ["a", 30],
      ["b", 20],
    ]);

    expect(result).toEqual([
      ["a", 6],
      ["b", 4],
    ]);
  });

  it("keeps proportional distribution cent-accurate", () => {
    const result = distributeBySharedExactShares(10, [
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);

    expect(result.reduce((sum, [, amount]) => sum + amount, 0)).toBe(10);
    expect(result).toEqual([
      ["a", 3.34],
      ["b", 3.33],
      ["c", 3.33],
    ]);
  });

  it("builds stable fingerprints from normalized transaction fields", () => {
    expect(
      buildTransactionFingerprint({
        date: "2026-01-15",
        description: "SWIGGY   ORDER #123",
        amount: 100,
        currency: "inr",
      })
    ).toBe(
      buildTransactionFingerprint({
        date: "2026-01-15",
        description: "swiggy order 123",
        amount: -100,
        currency: "INR",
      })
    );
  });

  it("flags rows that match existing expenses as duplicate-like", () => {
    const fingerprint = buildTransactionFingerprint({
      date: "2026-01-15",
      description: "Swiggy",
      amount: 100,
      currency: "INR",
    });

    expect(
      isDuplicateLikeImportRow(
        {
          date: "2026-01-15",
          description: "Swiggy",
          amount: 100,
          currency: "INR",
          transactionFingerprint: fingerprint,
        },
        [
          {
            description: "Different",
            amount: 100,
            currency: "INR",
            timestamp: new Date(2026, 0, 15).getTime(),
            transactionFingerprint: fingerprint,
          },
        ]
      )
    ).toBe(true);

    expect(
      toStatementImportRow(tx({ vendor: "Swiggy", amount: 100 }), {
        currency: "INR",
        existingExpenses: [
          {
            description: "swiggy",
            amount: 100,
            currency: "INR",
            timestamp: new Date(2026, 0, 15).getTime(),
          },
        ],
      }).selected
    ).toBe(false);
  });
});
