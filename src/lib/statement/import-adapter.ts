import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import { resolveExpenseCategorySlug } from "@/lib/expense-categories";
import type { SplitPair } from "@/lib/splits";
import type { ParsedStatementTransaction } from "./types";

const EXPENSE_TYPES = new Set<ParsedStatementTransaction["type"]>([
  "debit",
  "fee",
]);

export type StatementImportRow = ParsedStatementTransaction & {
  category: ExpenseCategorySlug;
  selectable: boolean;
};

export function toStatementImportRow(
  tx: ParsedStatementTransaction
): StatementImportRow {
  const category = tx.category ?? resolveExpenseCategorySlug(tx.suggestedCategoryName);
  const selectable = EXPENSE_TYPES.has(tx.type) && tx.amount > 0;
  return {
    ...tx,
    category,
    selected: selectable,
    selectable,
  };
}

export function distributeBySharedExactShares(
  amount: number,
  sharedSplits: SplitPair[]
): SplitPair[] {
  const totalSharedCents = sharedSplits.reduce(
    (sum, [, share]) => sum + Math.round(share * 100),
    0
  );
  const totalCents = Math.round(amount * 100);
  if (totalSharedCents <= 0 || totalCents <= 0) return [];

  const raw = sharedSplits.map(([id, share]) => {
    const shareCents = Math.round(share * 100);
    const exact = (totalCents * shareCents) / totalSharedCents;
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
