import { describe, expect, it } from "vitest";

import {
  resolveExpenseCategorySlug,
  suggestExpenseCategory,
} from "./expense-categories";

describe("expense categories", () => {
  it("resolves canonical category names and aliases", () => {
    expect(resolveExpenseCategorySlug("Food & Dining")).toBe("food-dining");
    expect(resolveExpenseCategorySlug("restaurants")).toBe("food-dining");
    expect(resolveExpenseCategorySlug("medical")).toBe("health");
  });

  it("falls back to other for unknown categories", () => {
    expect(resolveExpenseCategorySlug("not a real category")).toBe("other");
    expect(resolveExpenseCategorySlug(null)).toBe("other");
  });

  it("suggests categories from merchant names", () => {
    expect(suggestExpenseCategory("SWIGGY ORDER")?.categorySlug).toBe(
      "food-dining"
    );
    expect(suggestExpenseCategory("SHELL OIL 84721")?.categorySlug).toBe(
      "fuel"
    );
  });
});
