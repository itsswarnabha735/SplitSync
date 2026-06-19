import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import { suggestExpenseCategory } from "@/lib/expense-categories";

export interface CategorySuggestion {
  categoryName: string;
  confidence: number;
  matchedKeyword: string;
  learnedCategoryId?: ExpenseCategorySlug;
  isLearned?: boolean;
}

class AutoCategorizerService {
  suggestCategory(vendor: string): CategorySuggestion | null {
    const suggestion = suggestExpenseCategory(vendor);
    if (!suggestion) return null;
    return {
      categoryName: suggestion.categoryName,
      confidence: suggestion.confidence,
      matchedKeyword: suggestion.matchedKeyword,
      learnedCategoryId: suggestion.categorySlug,
      isLearned: true,
    };
  }
}

export const autoCategorizer = new AutoCategorizerService();
