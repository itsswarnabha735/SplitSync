import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import type { SplitType } from "@/lib/models";
import {
  buildSplitsForMethod,
  type DraftSplitMethod,
  type SplitPair,
  type SplitResult,
} from "@/lib/splits";

export type ExpenseDraftSource =
  | "manual"
  | "ai-text"
  | "pasted-message"
  | "receipt-image"
  | "statement-import";

export type ExpenseDraftContext = "group" | "friend";

export type ExpenseDraftStatus = "draft" | "ready" | "needs_review" | "saved";

export type ExpenseDraftField =
  | "description"
  | "amount"
  | "currency"
  | "paidById"
  | "date"
  | "category"
  | "splitMethod"
  | "participants"
  | "notes";

export type ExpenseWarningCode =
  | "missing-field"
  | "duplicate-like"
  | "low-confidence"
  | "money-movement"
  | "large-expense"
  | "participant-review";

export interface ExpenseWarning {
  code: ExpenseWarningCode;
  field?: ExpenseDraftField;
  message: string;
  blocking?: boolean;
}

export interface ExpenseDraftParticipant {
  included: boolean;
  value?: number;
}

export interface ExpenseDraft {
  id: string;
  context: ExpenseDraftContext;
  status: ExpenseDraftStatus;
  source: ExpenseDraftSource;
  description: string;
  amount: number | null;
  currency: string;
  paidById: string;
  date: string;
  category: ExpenseCategorySlug;
  splitMethod: DraftSplitMethod;
  participants: Record<string, ExpenseDraftParticipant>;
  notes?: string;
  evidenceText?: string;
  warnings: ExpenseWarning[];
  fieldConfidence: Partial<Record<ExpenseDraftField, number>>;
  fieldSource: Partial<Record<ExpenseDraftField, ExpenseDraftSource | "edited">>;
}

export interface ExpenseDraftBuildResult extends SplitResult {
  persistedSplitType: SplitType;
}

export interface ExistingExpenseForDuplicate {
  id: string;
  description: string;
  amount: number;
  currency: string;
  timestamp: number;
  paidById: string;
  splits: Record<string, number>;
  transactionFingerprint?: string;
}

export interface DuplicateExpenseCandidate {
  expense: ExistingExpenseForDuplicate;
  score: number;
  strength: "soft" | "hard";
  reasons: string[];
}

export function createExpenseDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSplitsFromDraft(
  draft: Pick<
    ExpenseDraft,
    "amount" | "currency" | "splitMethod" | "participants"
  >,
  options: {
    participantLabel?: string;
    exactInputs?: Record<string, string>;
    shareInputs?: Record<string, string>;
    percentInputs?: Record<string, string>;
    adjustmentInputs?: Record<string, string>;
  } = {}
): ExpenseDraftBuildResult {
  const amount = draft.amount ?? 0;
  const includedIds = Object.entries(draft.participants)
    .filter(([, state]) => state.included)
    .map(([id]) => id);

  const exactDistribution = parseInputMap(options.exactInputs);
  const shareDistribution = parseInputMap(options.shareInputs);
  const percentDistribution = parseInputMap(options.percentInputs);
  const adjustmentDistribution = parseInputMap(options.adjustmentInputs);

  return buildSplitsForMethod({
    splitMethod: draft.splitMethod,
    amount,
    equalParticipantIds: includedIds,
    exactDistribution,
    shareDistribution,
    percentDistribution,
    adjustmentDistribution,
    participantLabel: options.participantLabel,
    currency: draft.currency,
  });
}

export function validateExpenseDraft(params: {
  draft: ExpenseDraft;
  splitResult: SplitResult;
  requireParticipantReview?: boolean;
  moneyMovementAcknowledged?: boolean;
}): ExpenseWarning[] {
  const warnings: ExpenseWarning[] = [];
  const { draft } = params;

  if (!draft.description.trim()) {
    warnings.push({
      code: "missing-field",
      field: "description",
      message: "Add a description before saving.",
      blocking: true,
    });
  }
  if (!draft.amount || draft.amount <= 0) {
    warnings.push({
      code: "missing-field",
      field: "amount",
      message: "Amount must be greater than 0.",
      blocking: true,
    });
  }
  if (!draft.paidById) {
    warnings.push({
      code: "missing-field",
      field: "paidById",
      message: "Choose who paid.",
      blocking: true,
    });
  }
  if (!params.splitResult.ok) {
    warnings.push({
      code: "missing-field",
      field: "participants",
      message: params.splitResult.error ?? "Fix the split before saving.",
      blocking: true,
    });
  }
  if (params.requireParticipantReview) {
    warnings.push({
      code: "participant-review",
      field: "participants",
      message: "Confirm who is included before saving this group expense.",
      blocking: true,
    });
  }
  const sourceWarnings = draft.warnings.filter((warning) => {
    if (warning.code === "money-movement" && params.moneyMovementAcknowledged) {
      return false;
    }
    return warning.blocking;
  });
  warnings.push(...sourceWarnings);

  return dedupeWarnings(warnings);
}

export function buildDuplicateFingerprint(params: {
  date: string;
  description: string;
  amount: number;
  currency: string;
}): string {
  return [
    normalizeDateKey(params.date),
    normalizeDescription(params.description),
    Math.round(Math.abs(params.amount) * 100),
    params.currency.toUpperCase(),
  ].join("|");
}

export function findDuplicateExpenseCandidates(params: {
  draft: Pick<
    ExpenseDraft,
    "description" | "amount" | "currency" | "date" | "paidById" | "participants"
  >;
  existingExpenses: ExistingExpenseForDuplicate[];
  transactionFingerprint?: string;
}): DuplicateExpenseCandidate[] {
  const { draft } = params;
  if (!draft.description.trim() || !draft.amount || draft.amount <= 0) return [];

  const draftDate = normalizeDateKey(draft.date);
  const draftDescription = normalizeDescription(draft.description);
  const draftCents = Math.round(Math.abs(draft.amount) * 100);
  const draftCurrency = draft.currency.toUpperCase();
  const draftParticipants = includedParticipantSet(draft.participants);

  return params.existingExpenses
    .map((expense) => {
      const reasons: string[] = [];
      let score = 0;

      if (
        params.transactionFingerprint &&
        expense.transactionFingerprint === params.transactionFingerprint
      ) {
        score += 6;
        reasons.push("same transaction fingerprint");
      }

      const existingDate = dateKeyFromTimestamp(expense.timestamp);
      if (existingDate === draftDate) {
        score += 2;
        reasons.push("same date");
      } else if (Math.abs(daysBetween(existingDate, draftDate)) <= 1) {
        score += 1;
        reasons.push("nearby date");
      }

      if (normalizeDescription(expense.description) === draftDescription) {
        score += 3;
        reasons.push("same description");
      }
      if (Math.round(Math.abs(expense.amount) * 100) === draftCents) {
        score += 3;
        reasons.push("same amount");
      }
      if (expense.currency.toUpperCase() === draftCurrency) {
        score += 1;
        reasons.push("same currency");
      }
      if (expense.paidById === draft.paidById) {
        score += 1;
        reasons.push("same payer");
      }
      if (setsEqual(new Set(Object.keys(expense.splits)), draftParticipants)) {
        score += 1;
        reasons.push("same participants");
      }

      if (score < 7) return null;
      return {
        expense,
        score,
        strength: score >= 10 ? "hard" : "soft",
        reasons,
      } satisfies DuplicateExpenseCandidate;
    })
    .filter((candidate): candidate is DuplicateExpenseCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function summarizeIncludedParticipants(params: {
  participants: Array<{ id: string; name: string }>;
  selected: Record<string, boolean>;
}): { included: string; excluded: string } {
  const included = params.participants
    .filter((participant) => params.selected[participant.id] ?? true)
    .map((participant) => participant.name);
  const excluded = params.participants
    .filter((participant) => !(params.selected[participant.id] ?? true))
    .map((participant) => participant.name);
  return {
    included: included.length > 0 ? included.join(", ") : "No one selected",
    excluded: excluded.length > 0 ? excluded.join(", ") : "None",
  };
}

export function summarizeExpenseImpact(params: {
  payerName: string;
  amountLabel: string;
  description: string;
  date: string;
  shares: Array<{ name: string; amountLabel: string }>;
  visibleTo: string;
}): string {
  const description = params.description.trim() || "this expense";
  return `${params.payerName} paid ${params.amountLabel} for ${description} on ${
    params.date || "today"
  }. ${params.shares.length} ${
    params.shares.length === 1 ? "person" : "people"
  } will see updated balances in ${params.visibleTo}.`;
}

function parseInputMap(inputs: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(inputs ?? {})) {
    const value = parseFloat(raw);
    if (!Number.isNaN(value)) out[id] = value;
  }
  return out;
}

function includedParticipantSet(
  participants: Record<string, ExpenseDraftParticipant>
): Set<string> {
  return new Set(
    Object.entries(participants)
      .filter(([, state]) => state.included)
      .map(([id]) => id)
  );
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

function daysBetween(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = new Date(`${a}T00:00:00`).getTime();
  const right = new Date(`${b}T00:00:00`).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;
  return Math.round((left - right) / 86_400_000);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function dedupeWarnings(warnings: ExpenseWarning[]): ExpenseWarning[] {
  const seen = new Set<string>();
  const out: ExpenseWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.field ?? ""}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}
