import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  getExpenseCategoryKind,
  resolveExpenseCategorySlug,
} from "@/lib/expense-categories";
import type { ExpenseImportProvenance, StatementParserMode } from "@/lib/models";
import type { SplitPair } from "@/lib/splits";
import type { ParsedStatementTransaction } from "./types";

const EXPENSE_TYPES = new Set<ParsedStatementTransaction["type"]>([
  "debit",
  "fee",
]);

export type StatementImportRow = ParsedStatementTransaction & {
  category: ExpenseCategorySlug;
  selectable: boolean;
  transactionFingerprint: string;
  duplicateLike: boolean;
  warningFlags: StatementImportWarningFlag[];
};

export type StatementImportWarningFlag =
  | "duplicate-like"
  | "low-confidence"
  | "money-movement"
  | "out-of-period";

export interface ExistingImportedExpenseLike {
  description: string;
  amount: number;
  timestamp: number;
  currency: string;
  transactionFingerprint?: string;
}

export interface StatementImportRowOptions {
  currency: string;
  existingExpenses?: ExistingImportedExpenseLike[];
  statementPeriod?: { start: string | null; end: string | null };
}

export function toStatementImportRow(
  tx: ParsedStatementTransaction,
  options: StatementImportRowOptions = { currency: "USD" }
): StatementImportRow {
  const category = tx.category ?? resolveExpenseCategorySlug(tx.suggestedCategoryName);
  const fingerprint = buildTransactionFingerprint({
    date: tx.date,
    description: tx.vendor,
    amount: tx.amount,
    currency: options.currency,
  });
  const duplicateLike = isDuplicateLikeImportRow(
    {
      date: tx.date,
      description: tx.vendor,
      amount: tx.amount,
      currency: options.currency,
      transactionFingerprint: fingerprint,
    },
    options.existingExpenses ?? []
  );
  const categoryKind = getExpenseCategoryKind(category);
  const warningFlags: StatementImportWarningFlag[] = [];
  if (duplicateLike) warningFlags.push("duplicate-like");
  if (tx.confidence < 0.6) warningFlags.push("low-confidence");
  if (categoryKind !== "spend") warningFlags.push("money-movement");
  if (isOutOfStatementPeriod(tx.date, options.statementPeriod)) {
    warningFlags.push("out-of-period");
  }
  const selectable = EXPENSE_TYPES.has(tx.type) && tx.amount > 0;
  const selected = selectable && !duplicateLike && categoryKind === "spend";
  return {
    ...tx,
    category,
    selected,
    selectable,
    transactionFingerprint: fingerprint,
    duplicateLike,
    warningFlags,
  };
}

export function buildImportBatchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildImportProvenance(params: {
  batchId: string;
  parserMode: StatementParserMode;
  row: StatementImportRow;
}): Required<Pick<
  ExpenseImportProvenance,
  "sourceType" | "importBatchId" | "transactionFingerprint" | "parserMode"
>> &
  Pick<ExpenseImportProvenance, "parserConfidence"> {
  return {
    sourceType: "statement-import",
    importBatchId: params.batchId,
    transactionFingerprint: params.row.transactionFingerprint,
    parserMode: params.parserMode,
    parserConfidence: params.row.confidence,
  };
}

export function buildTransactionFingerprint(params: {
  date: string;
  description: string;
  amount: number;
  currency: string;
}): string {
  const cents = Math.round(Math.abs(params.amount) * 100);
  return [
    normalizeDateKey(params.date),
    normalizeDescription(params.description),
    cents,
    params.currency.toUpperCase(),
  ].join("|");
}

export function isDuplicateLikeImportRow(
  row: {
    date: string;
    description: string;
    amount: number;
    currency: string;
    transactionFingerprint: string;
  },
  existingExpenses: ExistingImportedExpenseLike[]
): boolean {
  const rowDate = normalizeDateKey(row.date);
  const rowDescription = normalizeDescription(row.description);
  const rowCents = Math.round(Math.abs(row.amount) * 100);
  const rowCurrency = row.currency.toUpperCase();

  return existingExpenses.some((expense) => {
    if (expense.transactionFingerprint === row.transactionFingerprint) {
      return true;
    }
    return (
      dateKeyFromTimestamp(expense.timestamp) === rowDate &&
      normalizeDescription(expense.description) === rowDescription &&
      Math.round(Math.abs(expense.amount) * 100) === rowCents &&
      expense.currency.toUpperCase() === rowCurrency
    );
  });
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

function normalizeDescription(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function dateKeyFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isOutOfStatementPeriod(
  date: string,
  statementPeriod?: { start: string | null; end: string | null }
): boolean {
  if (!statementPeriod?.start || !statementPeriod.end) return false;
  if (!normalizeDateKey(date)) return true;
  const value = new Date(`${date}T00:00:00`);
  const start = new Date(`${statementPeriod.start}T00:00:00`);
  const end = new Date(`${statementPeriod.end}T00:00:00`);
  start.setDate(start.getDate() - 7);
  end.setDate(end.getDate() + 7);
  return value < start || value > end;
}
