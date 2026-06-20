export const SETTLEMENT_COPILOT_CONTEXT_TYPES = [
  "dashboard",
  "group",
  "friend",
  "spend",
  "import-review",
] as const;

export const SETTLEMENT_COPILOT_SUGGESTION_TYPES = [
  "explain",
  "review-ledger",
  "copy-summary",
  "draft-reminder",
  "prioritize-settlement",
  "inspect-expense",
  "inspect-payment",
] as const;

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "account",
  "accountLast4",
  "auth",
  "createdByUid",
  "email",
  "fcmToken",
  "linkedUid",
  "memberUids",
  "phone",
  "photoUrl",
  "rawText",
  "statementText",
  "token",
  "uid",
]);

const MAX_PROMPT_LENGTH = 1000;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 60;
const MAX_DEPTH = 5;

export type SettlementCopilotContextType =
  (typeof SETTLEMENT_COPILOT_CONTEXT_TYPES)[number];

export type SettlementCopilotSuggestionType =
  (typeof SETTLEMENT_COPILOT_SUGGESTION_TYPES)[number];

export type SettlementCopilotWarningSeverity = "info" | "review" | "critical";

export interface SettlementCopilotContext {
  title: string;
  surface: SettlementCopilotContextType;
  summary?: string;
  facts?: string[];
  totals?: Record<string, number>;
  groups?: Array<Record<string, unknown>>;
  friends?: Array<Record<string, unknown>>;
  balances?: Array<Record<string, unknown>>;
  debts?: Array<Record<string, unknown>>;
  expenses?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  importRows?: Array<Record<string, unknown>>;
  warnings?: SettlementCopilotWarning[];
}

export interface SettlementCopilotRequest {
  contextType: SettlementCopilotContextType;
  userPrompt: string;
  locale: string;
  timezone: string;
  context: SettlementCopilotContext;
  capabilities: {
    draftOnly: true;
    suggestionTypes: SettlementCopilotSuggestionType[];
  };
}

export interface SettlementCopilotSection {
  title: string;
  body: string;
}

export interface SettlementCopilotSuggestion {
  type: SettlementCopilotSuggestionType;
  title: string;
  body: string;
  copyText?: string;
}

export interface SettlementCopilotWarning {
  severity: SettlementCopilotWarningSeverity;
  message: string;
  entityId?: string;
}

export interface SettlementCopilotEntityRef {
  type: "expense" | "payment" | "group" | "friend" | "member" | "import-row";
  id: string;
  label?: string;
}

export interface SettlementCopilotResponse {
  answer: string;
  sections: SettlementCopilotSection[];
  suggestions: SettlementCopilotSuggestion[];
  warnings: SettlementCopilotWarning[];
  entityRefs: SettlementCopilotEntityRef[];
  confidence: number;
  requiresReview: boolean;
}

type JsonRecord = Record<string, unknown>;

export function sanitizeSettlementCopilotPrompt(value: unknown): string {
  return String(value ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, "[number]")
    .replace(/\+?\d[\d ()-]{8,}\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "[phone]" : match;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);
}

export function sanitizeSettlementCopilotContext(
  value: unknown
): SettlementCopilotContext {
  const sanitized = sanitizeValue(value, 0);
  const record = isRecord(sanitized) ? sanitized : {};
  return {
    title: safeString(record.title, "Settlement context"),
    surface: contextTypeOrDefault(record.surface, "dashboard") ?? "dashboard",
    summary: optionalString(record.summary),
    facts: stringArray(record.facts),
    totals: numberRecord(record.totals),
    groups: recordArray(record.groups),
    friends: recordArray(record.friends),
    balances: recordArray(record.balances),
    debts: recordArray(record.debts),
    expenses: recordArray(record.expenses),
    payments: recordArray(record.payments),
    importRows: recordArray(record.importRows),
    warnings: warningArray(record.warnings),
  };
}

export function validateSettlementCopilotRequest(
  value: unknown
):
  | { ok: true; request: SettlementCopilotRequest }
  | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Invalid copilot request." };
  }

  const contextType = contextTypeOrDefault(value.contextType, null);
  if (!contextType) {
    return { ok: false, error: "Invalid copilot context." };
  }

  const userPrompt = sanitizeSettlementCopilotPrompt(value.userPrompt);
  if (userPrompt.replace(/\s+/g, "").length < 3) {
    return { ok: false, error: "Ask Copilot a little more detail." };
  }

  const context = sanitizeSettlementCopilotContext({
    ...(isRecord(value.context) ? value.context : {}),
    surface: contextType,
  });

  return {
    ok: true,
    request: {
      contextType,
      userPrompt,
      locale: safeString(value.locale, "en-US").slice(0, 40),
      timezone: safeString(value.timezone, "UTC").slice(0, 80),
      context,
      capabilities: {
        draftOnly: true,
        suggestionTypes: [...SETTLEMENT_COPILOT_SUGGESTION_TYPES],
      },
    },
  };
}

export function validateSettlementCopilotResponse(
  value: unknown,
  context: SettlementCopilotContext
): SettlementCopilotResponse {
  if (!isRecord(value)) {
    throw new Error("Copilot response was not valid JSON.");
  }

  const allowedEntityIds = collectContextEntityIds(context);
  const warnings = warningArray(value.warnings);
  const sections = recordArray(value.sections)
    .map((section) => ({
      title: safeString(section.title, "Details"),
      body: safeString(section.body, ""),
    }))
    .filter((section) => section.body);

  const suggestions: SettlementCopilotSuggestion[] = [];
  for (const suggestion of recordArray(value.suggestions)) {
    const type = suggestionTypeOrUndefined(suggestion.type);
    const body = safeString(suggestion.body, "");
    if (!type || !body) continue;
    suggestions.push({
      type,
      title: safeString(suggestion.title, suggestionTypeLabel(type)),
      body,
      copyText: optionalString(suggestion.copyText),
    });
  }

  const entityRefs: SettlementCopilotEntityRef[] = [];
  for (const ref of recordArray(value.entityRefs)) {
    const type = entityTypeOrUndefined(ref.type);
    const id = optionalString(ref.id);
    if (!type || !id || !allowedEntityIds.has(id)) continue;
    entityRefs.push({
      type,
      id,
      label: optionalString(ref.label),
    });
  }

  const answer = safeString(value.answer, "");
  if (!answer) throw new Error("Copilot response did not include an answer.");

  const confidence = clampNumber(value.confidence, 0.45, 0, 1);
  return {
    answer,
    sections,
    suggestions,
    warnings,
    entityRefs,
    confidence,
    requiresReview:
      typeof value.requiresReview === "boolean"
        ? value.requiresReview
        : warnings.some((warning) => warning.severity !== "info"),
  };
}

export function buildLocalSettlementCopilotResponse(
  request: SettlementCopilotRequest
): SettlementCopilotResponse {
  const { context, contextType, userPrompt } = request;
  const warnings = context.warnings ?? [];
  const facts = context.facts?.length
    ? context.facts.slice(0, 6)
    : ["I can only use the sanitized ledger summary currently available."];
  const lowerPrompt = userPrompt.toLowerCase();
  const wantsReminder = lowerPrompt.includes("remind");
  const wantsSummary =
    lowerPrompt.includes("summary") ||
    lowerPrompt.includes("whatsapp") ||
    lowerPrompt.includes("share");
  const wantsPriority =
    lowerPrompt.includes("first") ||
    lowerPrompt.includes("priority") ||
    lowerPrompt.includes("settle");

  const answer = localAnswerForContext(contextType, context, warnings);
  const suggestions: SettlementCopilotSuggestion[] = [];

  if (wantsSummary) {
    suggestions.push({
      type: "copy-summary",
      title: "Shareable summary draft",
      body: buildShareableSummary(context),
      copyText: buildShareableSummary(context),
    });
  }

  if (wantsReminder) {
    const draft = buildReminderDraft(context);
    suggestions.push({
      type: "draft-reminder",
      title: "Reminder draft",
      body: draft,
      copyText: draft,
    });
  }

  if (wantsPriority || suggestions.length === 0) {
    suggestions.push({
      type: "prioritize-settlement",
      title: "Next safe step",
      body: nextSafeStep(context, warnings),
    });
  }

  return {
    answer,
    sections: [
      {
        title: "What I checked",
        body: facts.join(" "),
      },
      {
        title: "Safety note",
        body: "This is a draft-only review. Balances and recommended payments still come from SplitSync's deterministic ledger.",
      },
    ],
    suggestions,
    warnings,
    entityRefs: firstEntityRefs(context),
    confidence: warnings.some((warning) => warning.severity === "critical")
      ? 0.62
      : 0.78,
    requiresReview: warnings.length > 0,
  };
}

export function collectContextEntityIds(
  context: SettlementCopilotContext
): Set<string> {
  const ids = new Set<string>();
  collectIds(context, ids);
  return ids;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isRecord(value)) {
    const out: JsonRecord = {};
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_CONTEXT_KEYS.has(key)) continue;
      const sanitized = sanitizeValue(nested, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  return undefined;
}

function sanitizeString(value: string): string {
  return sanitizeSettlementCopilotPrompt(value).slice(0, MAX_STRING_LENGTH);
}

function safeString(
  value: unknown,
  fallback: string,
  maxLength = MAX_STRING_LENGTH
): string {
  if (typeof value !== "string") return fallback;
  const sanitized = sanitizeString(value).slice(0, maxLength);
  return sanitized || fallback;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sanitized = sanitizeString(value);
  return sanitized || undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map(optionalString)
    .filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function recordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "number" && Number.isFinite(nested)) out[key] = nested;
  }
  return Object.keys(out).length ? out : undefined;
}

function warningArray(value: unknown): SettlementCopilotWarning[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((warning) => ({
      severity: warningSeverityOrDefault(warning.severity),
      message: safeString(warning.message, ""),
      entityId: optionalString(warning.entityId),
    }))
    .filter((warning) => warning.message);
}

function contextTypeOrDefault(
  value: unknown,
  fallback: SettlementCopilotContextType | null
): SettlementCopilotContextType | null {
  return SETTLEMENT_COPILOT_CONTEXT_TYPES.includes(
    value as SettlementCopilotContextType
  )
    ? (value as SettlementCopilotContextType)
    : fallback;
}

function suggestionTypeOrUndefined(
  value: unknown
): SettlementCopilotSuggestionType | undefined {
  return SETTLEMENT_COPILOT_SUGGESTION_TYPES.includes(
    value as SettlementCopilotSuggestionType
  )
    ? (value as SettlementCopilotSuggestionType)
    : undefined;
}

function warningSeverityOrDefault(
  value: unknown
): SettlementCopilotWarningSeverity {
  return value === "critical" || value === "review" || value === "info"
    ? value
    : "review";
}

function entityTypeOrUndefined(
  value: unknown
): SettlementCopilotEntityRef["type"] | undefined {
  return value === "expense" ||
    value === "payment" ||
    value === "group" ||
    value === "friend" ||
    value === "member" ||
    value === "import-row"
    ? value
    : undefined;
}

function suggestionTypeLabel(type: SettlementCopilotSuggestionType): string {
  const labels: Record<SettlementCopilotSuggestionType, string> = {
    explain: "Explanation",
    "review-ledger": "Review ledger",
    "copy-summary": "Copy summary",
    "draft-reminder": "Draft reminder",
    "prioritize-settlement": "Prioritize settlement",
    "inspect-expense": "Inspect expense",
    "inspect-payment": "Inspect payment",
  };
  return labels[type];
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectIds(value: unknown, ids: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.id === "string" && value.id.trim()) ids.add(value.id);
  if (typeof value.groupId === "string" && value.groupId.trim()) {
    ids.add(value.groupId);
  }
  if (typeof value.friendId === "string" && value.friendId.trim()) {
    ids.add(value.friendId);
  }
  for (const nested of Object.values(value)) collectIds(nested, ids);
}

function firstEntityRefs(
  context: SettlementCopilotContext
): SettlementCopilotEntityRef[] {
  const refs: SettlementCopilotEntityRef[] = [];
  for (const expense of context.expenses ?? []) {
    const id = optionalString(expense.id);
    if (id) refs.push({ type: "expense", id, label: optionalString(expense.description) });
  }
  for (const payment of context.payments ?? []) {
    const id = optionalString(payment.id);
    if (id) refs.push({ type: "payment", id, label: "Settlement payment" });
  }
  for (const row of context.importRows ?? []) {
    const id = optionalString(row.id);
    if (id) refs.push({ type: "import-row", id, label: optionalString(row.vendor) });
  }
  return refs.slice(0, 8);
}

function localAnswerForContext(
  contextType: SettlementCopilotContextType,
  context: SettlementCopilotContext,
  warnings: SettlementCopilotWarning[]
): string {
  const critical = warnings.filter((warning) => warning.severity === "critical");
  if (critical.length > 0) {
    return `I found ${critical.length} critical ledger issue${
      critical.length === 1 ? "" : "s"
    } that should be reviewed before settlement.`;
  }

  const title = context.title || "this view";
  const labels: Record<SettlementCopilotContextType, string> = {
    dashboard: "I reviewed your overall settlement picture.",
    group: `I reviewed ${title}'s balances and recommended payments.`,
    friend: `I reviewed your one-on-one balance for ${title}.`,
    spend: "I reviewed spend and imported-expense signals.",
    "import-review": "I reviewed the statement import rows for duplicate and review flags.",
  };
  return labels[contextType];
}

function buildShareableSummary(context: SettlementCopilotContext): string {
  const title = context.title || "SplitSync";
  const debts = context.debts ?? [];
  if (debts.length === 0) {
    return `${title}: everyone looks settled based on the current ledger. Please review before acting.`;
  }
  const lines = debts.slice(0, 8).map((debt) => {
    const debtor = safeString(debt.debtorName, "Someone", 80);
    const creditor = safeString(debt.creditorName, "someone", 80);
    const amount = typeof debt.amount === "number" ? debt.amount.toFixed(2) : "";
    const currency = safeString(debt.currency, "", 12);
    return `${debtor} pays ${creditor} ${currency} ${amount}`.trim();
  });
  return `${title} settlement summary:\n${lines.join(
    "\n"
  )}\nPlease review before acting.`;
}

function buildReminderDraft(context: SettlementCopilotContext): string {
  const summary = buildShareableSummary(context);
  return `Hi, quick SplitSync reminder:\n${summary}`;
}

function nextSafeStep(
  context: SettlementCopilotContext,
  warnings: SettlementCopilotWarning[]
): string {
  const critical = warnings.find((warning) => warning.severity === "critical");
  if (critical) return `Review this first: ${critical.message}`;
  if ((context.debts?.length ?? 0) > 0) {
    return "Review the recommended payments, then record settlements manually after money has actually moved.";
  }
  if ((context.importRows?.length ?? 0) > 0) {
    return "Review duplicate, money-movement, and low-confidence import rows before saving them.";
  }
  return "No immediate settlement action is required from this sanitized context.";
}
