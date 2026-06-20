import {
  getExpenseCategoryKind,
  isExpenseCategorySlug,
  resolveExpenseCategorySlug,
  suggestExpenseCategory,
  type ExpenseCategorySlug,
} from "@/lib/expense-categories";
import type { SplitType } from "@/lib/models";
import { buildSplits } from "@/lib/splits";
import {
  buildTransactionFingerprint,
  isDuplicateLikeImportRow,
  type ExistingImportedExpenseLike,
} from "@/lib/statement/import-adapter";

export const AUTOCOMPLETE_CONFIDENCE_THRESHOLD = 0.7;
export const AUTOCOMPLETE_MAX_INPUT_LENGTH = 600;
const MAX_RECENT_CONTEXT = 12;

export type ExpenseAutocompleteMode = "group" | "friend";

export type ExpenseAutocompleteWarningCode =
  | "low-confidence"
  | "duplicate-like"
  | "large-expense"
  | "category-other"
  | "ambiguous-participant"
  | "exact-split-mismatch"
  | "money-movement";

export interface ExpenseAutocompleteWarning {
  code: ExpenseAutocompleteWarningCode;
  message: string;
  field?: string;
}

export interface ExpenseAutocompleteParticipant {
  id: string;
  name: string;
  isCurrentUser: boolean;
  aliases?: string[];
}

export interface ExpenseAutocompleteRecentContext {
  description: string;
  amount: number;
  currency: string;
  category?: string;
  paidById: string;
  splitType: SplitType;
  participantIds: string[];
  timestamp: number;
}

export interface ExpenseAutocompleteRequest {
  input: string;
  mode: ExpenseAutocompleteMode;
  timezone: string;
  today: string;
  defaults: {
    currency: string;
    date: string;
    paidById: string;
    splitType: SplitType;
  };
  participants: ExpenseAutocompleteParticipant[];
  supportedCurrencies: string[];
  recentContext: ExpenseAutocompleteRecentContext[];
}

export interface ExpenseAutocompleteDraft {
  description?: string;
  amount?: number;
  currency?: string;
  date?: string;
  paidById?: string;
  category?: ExpenseCategorySlug;
  splitType?: SplitType;
  equalParticipantIds?: string[];
  exactSplits?: Record<string, number>;
}

export type ExpenseAutocompleteConfidence = Record<string, number>;

export interface ExpenseAutocompleteResponse {
  draft: ExpenseAutocompleteDraft;
  confidence: ExpenseAutocompleteConfidence;
  warnings: ExpenseAutocompleteWarning[];
}

export type ExpenseAutocompleteStatus =
  | "filled"
  | "partial"
  | "needs_review"
  | "failed";

export interface AppliedExpenseAutocomplete {
  status: ExpenseAutocompleteStatus;
  draft: ExpenseAutocompleteDraft;
  confidence: ExpenseAutocompleteConfidence;
  appliedFields: string[];
  warnings: ExpenseAutocompleteWarning[];
  fields: {
    description?: string;
    amountStr?: string;
    currency?: string;
    dateStr?: string;
    paidBy?: string;
    category?: ExpenseCategorySlug;
    splitType?: SplitType;
    equalSelections?: Record<string, boolean>;
    exactInputs?: Record<string, string>;
  };
}

export interface ExpenseAutocompleteCurrentFields {
  description: string;
  amountStr: string;
  currency: string;
  dateStr: string;
  paidBy: string;
  category: ExpenseCategorySlug;
  splitType: SplitType;
}

export function sanitizeExpenseAutocompleteInput(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[number]")
    .replace(/\+?\d[\d ()-]{8,}\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "[phone]" : match;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, AUTOCOMPLETE_MAX_INPUT_LENGTH);
}

export function validateExpenseAutocompleteRequest(
  value: unknown
):
  | { ok: true; request: ExpenseAutocompleteRequest }
  | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Invalid request." };
  }

  const input = String(value.input ?? "").trim();
  if (input.replace(/\s+/g, "").length < 4) {
    return { ok: false, error: "Describe the expense in a few more words." };
  }
  if (input.length > AUTOCOMPLETE_MAX_INPUT_LENGTH) {
    return { ok: false, error: "Expense prompt is too long." };
  }

  const mode =
    value.mode === "group" || value.mode === "friend" ? value.mode : null;
  if (!mode) return { ok: false, error: "Invalid expense mode." };

  const defaults = isRecord(value.defaults) ? value.defaults : {};
  const defaultSplitType = splitTypeOrUndefined(defaults.splitType) ?? "EQUAL";

  const participants = normalizeParticipants(value.participants);
  if (participants.length === 0) {
    return { ok: false, error: "No participants are available." };
  }

  const supportedCurrencies = normalizeCurrencyList(value.supportedCurrencies);
  if (supportedCurrencies.length === 0) {
    return { ok: false, error: "No supported currencies are available." };
  }

  const request: ExpenseAutocompleteRequest = {
    input,
    mode,
    timezone:
      typeof value.timezone === "string" && value.timezone.trim()
        ? value.timezone.trim()
        : "UTC",
    today: normalizeDate(value.today) ?? todayKey(),
    defaults: {
      currency:
        normalizeCurrency(defaults.currency, supportedCurrencies) ??
        supportedCurrencies[0]!,
      date: normalizeDate(defaults.date) ?? todayKey(),
      paidById:
        typeof defaults.paidById === "string" &&
        participants.some((p) => p.id === defaults.paidById)
          ? defaults.paidById
          : participants[0]!.id,
      splitType: defaultSplitType,
    },
    participants,
    supportedCurrencies,
    recentContext: normalizeRecentContext(value.recentContext).slice(
      0,
      MAX_RECENT_CONTEXT
    ),
  };

  return { ok: true, request };
}

export function validateExpenseAutocompleteResponse(
  value: unknown,
  request: ExpenseAutocompleteRequest
): ExpenseAutocompleteResponse {
  const source = isRecord(value) && isRecord(value.draft) ? value : { draft: value };
  const draftInput = isRecord(source.draft) ? source.draft : {};
  const participantIds = new Set(request.participants.map((p) => p.id));
  const warnings = normalizeWarnings(
    isRecord(source) ? source.warnings : undefined
  );

  const draft: ExpenseAutocompleteDraft = {};
  const confidence = normalizeConfidence(
    isRecord(source) ? source.confidence : undefined
  );

  if (typeof draftInput.description === "string") {
    const description = draftInput.description.trim().slice(0, 120);
    if (description) draft.description = description;
  }

  const amount = numberOrUndefined(draftInput.amount);
  if (amount !== undefined && amount > 0) {
    draft.amount = roundMoney(amount);
  }

  const currency = normalizeCurrency(
    draftInput.currency,
    request.supportedCurrencies
  );
  if (currency) draft.currency = currency;

  const date = normalizeDate(draftInput.date);
  if (date) draft.date = date;

  if (
    typeof draftInput.paidById === "string" &&
    participantIds.has(draftInput.paidById)
  ) {
    draft.paidById = draftInput.paidById;
  } else if (typeof draftInput.paidById === "string" && draftInput.paidById) {
    warnings.push({
      code: "ambiguous-participant",
      field: "paidById",
      message: "The payer could not be matched to an available participant.",
    });
  }

  if (typeof draftInput.category === "string") {
    const category = resolveExpenseCategorySlug(draftInput.category);
    draft.category = category;
  }

  const splitType = splitTypeOrUndefined(draftInput.splitType);
  if (splitType) draft.splitType = splitType;

  if (Array.isArray(draftInput.equalParticipantIds)) {
    const ids = uniqueStrings(draftInput.equalParticipantIds).filter((id) =>
      participantIds.has(id)
    );
    const unknownCount = uniqueStrings(draftInput.equalParticipantIds).length - ids.length;
    if (unknownCount > 0) {
      warnings.push({
        code: "ambiguous-participant",
        field: "equalParticipantIds",
        message: "One or more split participants could not be matched.",
      });
    }
    if (ids.length > 0) draft.equalParticipantIds = ids;
  }

  if (isRecord(draftInput.exactSplits)) {
    const exactSplits: Record<string, number> = {};
    for (const [id, rawAmount] of Object.entries(draftInput.exactSplits)) {
      if (!participantIds.has(id)) {
        warnings.push({
          code: "ambiguous-participant",
          field: "exactSplits",
          message: "One or more exact split participants could not be matched.",
        });
        continue;
      }
      const splitAmount = numberOrUndefined(rawAmount);
      if (splitAmount !== undefined && splitAmount >= 0) {
        exactSplits[id] = roundMoney(splitAmount);
      }
    }
    if (Object.keys(exactSplits).length > 0) draft.exactSplits = exactSplits;
  }

  if (draft.category === "other") {
    warnings.push({
      code: "category-other",
      field: "category",
      message: "Category is Other. Review it before saving.",
    });
  }

  if (draft.category && getExpenseCategoryKind(draft.category) !== "spend") {
    warnings.push({
      code: "money-movement",
      field: "category",
      message: "This looks like a transfer, refund, income, or other money movement.",
    });
  }

  if (draft.exactSplits && draft.amount !== undefined) {
    const result = buildSplits({
      splitType: "EXACT",
      amount: draft.amount,
      exactDistribution: draft.exactSplits,
      equalParticipantIds: [],
      participantLabel: "participant",
    });
    if (!result.ok) {
      warnings.push({
        code: "exact-split-mismatch",
        field: "exactSplits",
        message: result.error ?? "Exact split amounts do not match the total.",
      });
    }
  }

  const duplicate = detectDuplicateLikeWarning(draft, request.recentContext);
  if (duplicate) warnings.push(duplicate);

  return {
    draft,
    confidence,
    warnings: uniqueWarnings(warnings),
  };
}

export function applyExpenseAutocompleteDraft(params: {
  response: ExpenseAutocompleteResponse;
  current: ExpenseAutocompleteCurrentFields;
  participants: ExpenseAutocompleteParticipant[];
  supportedCurrencies: string[];
  threshold?: number;
}): AppliedExpenseAutocomplete {
  const threshold = params.threshold ?? AUTOCOMPLETE_CONFIDENCE_THRESHOLD;
  const { draft, confidence } = params.response;
  const participantIds = new Set(params.participants.map((p) => p.id));
  const fields: AppliedExpenseAutocomplete["fields"] = {};
  const appliedFields: string[] = [];
  const warnings = [...params.response.warnings];

  function canApply(field: string): boolean {
    const value = confidence[field] ?? 0;
    if (value >= threshold) return true;
    if (field in draft || field === "equalParticipantIds" || field === "exactSplits") {
      warnings.push({
        code: "low-confidence",
        field,
        message: `AI confidence was low for ${field}. Review this field manually.`,
      });
    }
    return false;
  }

  if (draft.description && canApply("description")) {
    fields.description = draft.description;
    appliedFields.push("description");
  }
  if (draft.amount !== undefined && canApply("amount")) {
    fields.amountStr = draft.amount.toFixed(2);
    appliedFields.push("amount");
  }
  if (
    draft.currency &&
    params.supportedCurrencies.includes(draft.currency) &&
    canApply("currency")
  ) {
    fields.currency = draft.currency;
    appliedFields.push("currency");
  }
  if (draft.date && canApply("date")) {
    fields.dateStr = draft.date;
    appliedFields.push("date");
  }
  if (draft.paidById && participantIds.has(draft.paidById) && canApply("paidById")) {
    fields.paidBy = draft.paidById;
    appliedFields.push("paidById");
  }
  if (
    draft.category &&
    isExpenseCategorySlug(draft.category) &&
    canApply("category")
  ) {
    fields.category = draft.category;
    appliedFields.push("category");
  }
  if (draft.splitType && canApply("splitType")) {
    fields.splitType = draft.splitType;
    appliedFields.push("splitType");
  }

  const appliedSplitType = fields.splitType ?? params.current.splitType;
  if (
    appliedSplitType === "EQUAL" &&
    draft.equalParticipantIds &&
    canApply("equalParticipantIds")
  ) {
    const selected = new Set(
      draft.equalParticipantIds.filter((id) => participantIds.has(id))
    );
    if (selected.size > 0) {
      fields.equalSelections = Object.fromEntries(
        params.participants.map((p) => [p.id, selected.has(p.id)])
      );
      appliedFields.push("equalParticipantIds");
    }
  }

  if (
    appliedSplitType === "EXACT" &&
    draft.exactSplits &&
    draft.amount !== undefined &&
    canApply("exactSplits")
  ) {
    const result = buildSplits({
      splitType: "EXACT",
      amount: draft.amount,
      equalParticipantIds: [],
      exactDistribution: draft.exactSplits,
      participantLabel: "participant",
    });
    if (result.ok) {
      fields.exactInputs = Object.fromEntries(
        Object.entries(draft.exactSplits).map(([id, amount]) => [
          id,
          amount.toFixed(2),
        ])
      );
      appliedFields.push("exactSplits");
    }
  }

  const unique = uniqueWarnings(warnings);
  const blockingReview = unique.some((warning) =>
    [
      "low-confidence",
      "ambiguous-participant",
      "exact-split-mismatch",
      "money-movement",
    ].includes(warning.code)
  );

  let status: ExpenseAutocompleteStatus = "partial";
  if (appliedFields.length === 0) status = "failed";
  else if (blockingReview) status = "needs_review";
  else if (appliedFields.length >= 4) status = "filled";

  return {
    status,
    draft,
    confidence,
    appliedFields,
    warnings: unique,
    fields,
  };
}

export function detectDuplicateLikeWarning(
  draft: ExpenseAutocompleteDraft,
  recentContext: ExpenseAutocompleteRecentContext[]
): ExpenseAutocompleteWarning | null {
  if (
    !draft.description ||
    draft.amount === undefined ||
    !draft.currency ||
    !draft.date
  ) {
    return null;
  }

  const fingerprint = buildTransactionFingerprint({
    date: draft.date,
    description: draft.description,
    amount: draft.amount,
    currency: draft.currency,
  });

  const existingExpenses: ExistingImportedExpenseLike[] = recentContext.map(
    (entry) => ({
      description: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      timestamp: entry.timestamp,
    })
  );

  if (
    isDuplicateLikeImportRow(
      {
        date: draft.date,
        description: draft.description,
        amount: draft.amount,
        currency: draft.currency,
        transactionFingerprint: fingerprint,
      },
      existingExpenses
    )
  ) {
    return {
      code: "duplicate-like",
      message: "This looks similar to an existing expense.",
    };
  }

  return null;
}

export function detectLargeExpenseWarning(params: {
  amount?: number;
  currency?: string;
  thresholds: Record<string, number>;
}): ExpenseAutocompleteWarning | null {
  const { amount, currency, thresholds } = params;
  if (amount === undefined || !currency) return null;
  const threshold = thresholds[currency];
  if (typeof threshold !== "number" || threshold <= 0 || amount < threshold) {
    return null;
  }
  return {
    code: "large-expense",
    field: "amount",
    message: "This crosses your configured large-expense threshold.",
  };
}

export function buildLocalExpenseAutocompleteResponse(
  request: ExpenseAutocompleteRequest
): ExpenseAutocompleteResponse {
  const input = sanitizeExpenseAutocompleteInput(request.input);
  const lower = input.toLowerCase();
  const participants = request.participants;
  const draft: ExpenseAutocompleteDraft = {};
  const confidence: ExpenseAutocompleteConfidence = {};
  const warnings: ExpenseAutocompleteWarning[] = [];

  const currency = detectCurrency(input, request.supportedCurrencies);
  if (currency) {
    draft.currency = currency;
    confidence.currency = 0.82;
  } else {
    draft.currency = request.defaults.currency;
    confidence.currency = 0.55;
  }

  const amount = detectAmount(input, draft.currency);
  if (amount !== null) {
    draft.amount = amount;
    confidence.amount = 0.82;
  }

  const date = detectRelativeDate(lower, request.today);
  if (date) {
    draft.date = date;
    confidence.date = 0.76;
  }

  const payer = resolvePayer(lower, participants);
  if (payer.status === "matched") {
    draft.paidById = payer.id;
    confidence.paidById = 0.82;
  } else if (payer.status === "ambiguous") {
    warnings.push({
      code: "ambiguous-participant",
      field: "paidById",
      message: "The payer name matched more than one participant.",
    });
  }

  const selectedParticipants = resolveSplitParticipants(lower, participants);
  if (selectedParticipants.status === "all") {
    draft.equalParticipantIds = participants.map((p) => p.id);
    confidence.equalParticipantIds = 0.8;
  } else if (selectedParticipants.status === "matched") {
    const currentUserId = participants.find((p) => p.isCurrentUser)?.id;
    draft.equalParticipantIds =
      request.mode === "friend" && currentUserId
        ? Array.from(new Set([currentUserId, ...selectedParticipants.ids]))
        : selectedParticipants.ids;
    confidence.equalParticipantIds = 0.76;
  } else if (selectedParticipants.status === "ambiguous") {
    warnings.push({
      code: "ambiguous-participant",
      field: "equalParticipantIds",
      message: "One or more participant names were ambiguous.",
    });
  }

  if (/\b(exact|exactly|i owe|owes|share)\b/.test(lower)) {
    draft.splitType = "EXACT";
    confidence.splitType = 0.72;
  } else {
    draft.splitType = "EQUAL";
    confidence.splitType = 0.75;
  }

  const description = deriveDescription(input, amount, draft.currency);
  if (description) {
    draft.description = description;
    confidence.description = 0.76;
    const category = suggestExpenseCategory(description);
    if (category) {
      draft.category = category.categorySlug;
      confidence.category = Math.max(0.7, category.confidence);
    }
  }

  if (!draft.category) {
    draft.category = "other";
    confidence.category = 0.55;
  }

  const normalized = validateExpenseAutocompleteResponse(
    { draft, confidence, warnings },
    request
  );

  if (normalized.draft.amount === undefined || !normalized.draft.description) {
    normalized.warnings.push({
      code: "low-confidence",
      message: "Only part of the expense could be read locally.",
    });
  }

  return {
    ...normalized,
    warnings: uniqueWarnings(normalized.warnings),
  };
}

export function mergeAutocompleteWarnings(
  ...groups: ExpenseAutocompleteWarning[][]
): ExpenseAutocompleteWarning[] {
  return uniqueWarnings(groups.flat());
}

function normalizeParticipants(value: unknown): ExpenseAutocompleteParticipant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!id || !name) return [];
    const aliases = Array.isArray(item.aliases)
      ? item.aliases
          .filter((alias): alias is string => typeof alias === "string")
          .map((alias) => alias.trim())
          .filter(Boolean)
      : [];
    return [
      {
        id,
        name,
        isCurrentUser: item.isCurrentUser === true,
        aliases,
      },
    ];
  });
}

function normalizeRecentContext(value: unknown): ExpenseAutocompleteRecentContext[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const amount = numberOrUndefined(item.amount);
    const currency = typeof item.currency === "string" ? item.currency.trim() : "";
    const paidById = typeof item.paidById === "string" ? item.paidById : "";
    const splitType = splitTypeOrUndefined(item.splitType) ?? "EQUAL";
    const timestamp = numberOrUndefined(item.timestamp) ?? 0;
    if (!description || amount === undefined || !currency) return [];
    return [
      {
        description,
        amount,
        currency: currency.toUpperCase(),
        category:
          typeof item.category === "string" ? item.category.trim() : undefined,
        paidById,
        splitType,
        participantIds: Array.isArray(item.participantIds)
          ? uniqueStrings(item.participantIds)
          : [],
        timestamp,
      },
    ];
  });
}

function normalizeCurrencyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value).map((code) => code.toUpperCase());
}

function normalizeWarnings(value: unknown): ExpenseAutocompleteWarning[] {
  if (!Array.isArray(value)) return [];
  const validCodes = new Set<ExpenseAutocompleteWarningCode>([
    "low-confidence",
    "duplicate-like",
    "large-expense",
    "category-other",
    "ambiguous-participant",
    "exact-split-mismatch",
    "money-movement",
  ]);
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.code !== "string") return [];
    if (!validCodes.has(item.code as ExpenseAutocompleteWarningCode)) return [];
    return [
      {
        code: item.code as ExpenseAutocompleteWarningCode,
        message:
          typeof item.message === "string" && item.message.trim()
            ? item.message.trim()
            : defaultWarningMessage(item.code as ExpenseAutocompleteWarningCode),
        field:
          typeof item.field === "string" && item.field.trim()
            ? item.field.trim()
            : undefined,
      },
    ];
  });
}

function normalizeConfidence(value: unknown): ExpenseAutocompleteConfidence {
  if (!isRecord(value)) return {};
  const out: ExpenseAutocompleteConfidence = {};
  for (const [key, raw] of Object.entries(value)) {
    const numeric = numberOrUndefined(raw);
    if (numeric !== undefined) out[key] = Math.max(0, Math.min(1, numeric));
  }
  return out;
}

function splitTypeOrUndefined(value: unknown): SplitType | undefined {
  return value === "EQUAL" || value === "EXACT" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeCurrency(
  value: unknown,
  supportedCurrencies: string[]
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return supportedCurrencies.includes(normalized) ? normalized : undefined;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function todayKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function uniqueStrings(value: unknown[]): string[] {
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function uniqueWarnings(
  warnings: ExpenseAutocompleteWarning[]
): ExpenseAutocompleteWarning[] {
  const seen = new Set<string>();
  const out: ExpenseAutocompleteWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.field ?? ""}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}

function defaultWarningMessage(code: ExpenseAutocompleteWarningCode): string {
  switch (code) {
    case "duplicate-like":
      return "This looks similar to an existing expense.";
    case "large-expense":
      return "This crosses your configured large-expense threshold.";
    case "category-other":
      return "Category is Other. Review it before saving.";
    case "ambiguous-participant":
      return "A participant could not be matched confidently.";
    case "exact-split-mismatch":
      return "Exact split amounts do not match the total.";
    case "money-movement":
      return "This looks like money movement rather than spending.";
    case "low-confidence":
    default:
      return "One or more fields need review.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function detectCurrency(input: string, supportedCurrencies: string[]): string | null {
  const upper = input.toUpperCase();
  for (const code of supportedCurrencies) {
    if (new RegExp(`\\b${code}\\b`, "i").test(input)) return code;
  }
  const symbolMap: Record<string, string> = {
    "₹": "INR",
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
  };
  for (const [symbol, code] of Object.entries(symbolMap)) {
    if (upper.includes(symbol) && supportedCurrencies.includes(code)) {
      return code;
    }
  }
  return null;
}

function detectAmount(input: string, currency?: string): number | null {
  const symbolPattern =
    currency === "INR"
      ? /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i
      : /(?:[$€£¥]|usd|eur|gbp|jpy|cad|aud)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i;
  const symbolMatch = symbolPattern.exec(input);
  const raw =
    symbolMatch?.[1] ??
    /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:inr|usd|eur|gbp|jpy|cad|aud|rs\.?)?\b/i.exec(
      input
    )?.[1];
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : null;
}

function detectRelativeDate(input: string, today: string): string | undefined {
  const base = normalizeDate(today);
  if (!base) return undefined;
  if (/\btoday\b/.test(input)) return base;
  const date = new Date(`${base}T00:00:00Z`);
  if (/\byesterday\b|\blast night\b/.test(input)) {
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  return undefined;
}

function resolvePayer(
  input: string,
  participants: ExpenseAutocompleteParticipant[]
):
  | { status: "matched"; id: string }
  | { status: "ambiguous" }
  | { status: "none" } {
  if (/\bpaid by (me|myself|i)\b|\bmy card\b|\bi paid\b/.test(input)) {
    const me = participants.find((p) => p.isCurrentUser);
    return me ? { status: "matched", id: me.id } : { status: "none" };
  }
  const match = /\bpaid by ([a-z][a-z .'-]{1,40})\b/i.exec(input);
  if (!match?.[1]) return { status: "none" };
  return resolveParticipantName(match[1], participants);
}

function resolveSplitParticipants(
  input: string,
  participants: ExpenseAutocompleteParticipant[]
):
  | { status: "all" }
  | { status: "matched"; ids: string[] }
  | { status: "ambiguous" }
  | { status: "none" } {
  if (/\b(everyone|everybody|all)\b/.test(input)) return { status: "all" };
  const match =
    /\b(?:split with|with|between|only)\s+([a-z][a-z ,&.'-]{1,80})\b/i.exec(
      input
    );
  if (!match?.[1]) return { status: "none" };
  const names = match[1]
    .split(/\s*(?:,|&| and )\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  const ids: string[] = [];
  for (const name of names) {
    const resolved = resolveParticipantName(name, participants);
    if (resolved.status === "ambiguous") return { status: "ambiguous" };
    if (resolved.status === "matched") ids.push(resolved.id);
  }
  return ids.length > 0 ? { status: "matched", ids: Array.from(new Set(ids)) } : { status: "none" };
}

function resolveParticipantName(
  name: string,
  participants: ExpenseAutocompleteParticipant[]
):
  | { status: "matched"; id: string }
  | { status: "ambiguous" }
  | { status: "none" } {
  const normalized = normalizeLookup(name);
  if (["me", "myself", "i", "you"].includes(normalized)) {
    const me = participants.find((p) => p.isCurrentUser);
    return me ? { status: "matched", id: me.id } : { status: "none" };
  }
  const matches = participants.filter((participant) =>
    participantNames(participant).some((candidate) => candidate === normalized)
  );
  if (matches.length === 1) return { status: "matched", id: matches[0]!.id };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}

function participantNames(participant: ExpenseAutocompleteParticipant): string[] {
  return [participant.name, ...(participant.aliases ?? [])]
    .map(normalizeLookup)
    .filter(Boolean);
}

function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function deriveDescription(
  input: string,
  amount: number | null,
  currency?: string
): string | undefined {
  let value = input
    .replace(/\bpaid by\b.*$/i, "")
    .replace(/\bsplit\b.*$/i, "")
    .replace(/\bwith\b.*$/i, "")
    .replace(/\bon\b.*$/i, "")
    .replace(/\byesterday\b|\btoday\b|\blast night\b/gi, "")
    .trim();
  if (amount !== null) {
    const amountText = String(amount).replace(/\.00$/, "");
    value = value
      .replace(new RegExp(`(?:₹|rs\\.?|inr|usd|eur|gbp|jpy|cad|aud|[$€£¥])?\\s*${escapeRegExp(amountText)}(?:\\.00)?`, "i"), "")
      .trim();
  }
  if (currency) value = value.replace(new RegExp(`\\b${currency}\\b`, "i"), "").trim();
  return value.replace(/\s+/g, " ").slice(0, 80) || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
