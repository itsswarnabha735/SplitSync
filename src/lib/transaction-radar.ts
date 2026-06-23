import {
  buildDuplicateFingerprint,
  findDuplicateExpenseCandidates,
  type ExistingExpenseForDuplicate,
} from "@/lib/expense-drafts";
import {
  suggestExpenseCategory,
  type ExpenseCategorySlug,
} from "@/lib/expense-categories";
import type {
  AdHocExpense,
  Friend,
  Group,
  GroupMember,
  SplitType,
  TransactionCandidate,
  TransactionCandidateStatus,
  TransactionCandidateType,
  TransactionRadarReasonCode,
  TransactionRule,
  TransactionSuggestedSplit,
  TransactionSuggestedTarget,
} from "@/lib/models";
import { YOU_ID } from "@/lib/models";

const DEFAULT_RETENTION_DAYS = 30;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

const EXCLUSION_RE =
  /\b(?:otp|one[-\s]?time password|verification code|login|password|statement generated|monthly statement|e[-\s]?statement|offer|cashback offer|sale|reward points|limit increased|bill generated)\b/i;
const TRANSACTION_RE =
  /\b(?:spent|debited|charged|paid|payment|purchase|transaction|sent|received|credited|refund|reversal|cash withdrawal|atm withdrawal|receipt|invoice)\b/i;
const MONEY_RE =
  /(?:₹|rs\.?|inr|usd|\$|eur|€|gbp|£|cad|aud|jpy|¥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:₹|rs\.?|inr|usd|eur|gbp|cad|aud|jpy)\b/i;

export interface GmailTransactionInput {
  messageId: string;
  threadId?: string;
  sender: string;
  subject: string;
  snippet?: string;
  body?: string;
  receivedAt?: number;
}

export interface GroupContextSlice {
  group: Group;
  members: GroupMember[];
  expenses: ExistingExpenseForDuplicate[];
}

export interface CandidateContextInput {
  candidate: TransactionCandidate;
  groupSlices: GroupContextSlice[];
  friends: Friend[];
  adHocExpenses: AdHocExpense[];
  rules: TransactionRule[];
}

export interface CandidateDuplicateResult {
  duplicateConfidence: number;
  status?: TransactionCandidateStatus;
  matchingExpenseId?: string;
  matchingExpensePath?: string;
}

type ExistingExpenseWithPath = ExistingExpenseForDuplicate & { path: string };

export function parseGmailTransactionCandidate(
  input: GmailTransactionInput,
  options: {
    userId: string;
    now?: number;
    retentionDays?: number;
  }
): TransactionCandidate | null {
  const now = options.now ?? Date.now();
  const fullText = [input.subject, input.snippet, input.body]
    .filter(Boolean)
    .join("\n");
  const compact = normalizeWhitespace(fullText);

  if (!TRANSACTION_RE.test(compact)) return null;
  if (EXCLUSION_RE.test(compact)) return null;

  const amountMatch = firstMoneyMatch(compact);
  if (!amountMatch) return null;

  const merchant = deriveMerchant(compact, input.sender, amountMatch.index);
  const normalizedMerchant = normalizeMerchant(merchant);
  const candidateType = classifyCandidate(compact);
  const transactionAt = deriveTransactionTime(compact, input.receivedAt ?? now);
  const category = suggestExpenseCategory(merchant)?.categorySlug ?? "other";
  const parseConfidence = clamp(
    0.45 +
      (merchant ? 0.18 : 0) +
      (candidateType === "spend" ? 0.16 : 0) +
      (input.sender ? 0.08 : 0) +
      (transactionAt ? 0.08 : 0)
  );
  const fingerprint = buildTransactionFingerprint({
    merchant: normalizedMerchant,
    amount: amountMatch.amount,
    currency: amountMatch.currency,
    transactionAt,
    sourceSender: input.sender,
  });
  const status: TransactionCandidateStatus =
    candidateType === "spend" && parseConfidence >= 0.68 ? "suggested" : "new";
  const paymentInstrumentHint = derivePaymentInstrumentHint(compact);

  return {
    id: input.messageId,
    userId: options.userId,
    source: "gmail",
    sourceMessageId: input.messageId,
    sourceThreadId: input.threadId ?? input.messageId,
    sourceSender: input.sender.trim().slice(0, 180),
    sourceSubjectHash: stableHash(input.subject),
    rawSnippetRedacted: redactSnippet(input.snippet || input.subject || compact),
    merchant: merchant || "Unknown merchant",
    normalizedMerchant: normalizedMerchant || "unknown",
    amount: amountMatch.amount,
    currency: amountMatch.currency,
    transactionAt,
    detectedAt: now,
    ...(paymentInstrumentHint ? { paymentInstrumentHint } : {}),
    category,
    candidateType,
    status,
    confidence: parseConfidence,
    parseConfidence,
    contextConfidence: 0,
    duplicateConfidence: 0,
    fingerprint,
    sourceRetentionExpiresAt:
      now + (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * MILLIS_PER_DAY,
    updatedAt: now,
  };
}

export function enrichCandidateContext(
  input: CandidateContextInput
): TransactionCandidate {
  const suggestedTarget = suggestTarget(input);
  const duplicate = detectCandidateDuplicate(
    input.candidate,
    input.groupSlices,
    input.adHocExpenses
  );
  const contextConfidence = suggestedTarget?.confidence ?? 0;
  const confidence = clamp(
    input.candidate.parseConfidence * 0.56 +
      contextConfidence * 0.34 -
      duplicate.duplicateConfidence * 0.35
  );
  const suggestedSplit = suggestedTarget
    ? buildSuggestedSplit(suggestedTarget, input.groupSlices, input.friends)
    : undefined;

  return {
    ...input.candidate,
    suggestedTarget,
    suggestedSplit,
    contextConfidence,
    duplicateConfidence: duplicate.duplicateConfidence,
    confidence,
    duplicateExpensePath: duplicate.matchingExpensePath,
    status:
      duplicate.status ??
      (suggestedTarget && confidence >= 0.7 ? "suggested" : "new"),
    updatedAt: Date.now(),
  };
}

export function detectCandidateDuplicate(
  candidate: TransactionCandidate,
  groupSlices: GroupContextSlice[],
  adHocExpenses: AdHocExpense[]
): CandidateDuplicateResult {
  const date = dateKey(candidate.transactionAt);
  const draft = {
    description: candidate.merchant,
    amount: candidate.amount,
    currency: candidate.currency,
    date,
    paidById: "",
    participants: {},
  };
  const existing: ExistingExpenseWithPath[] = [
    ...groupSlices.flatMap((slice) =>
      slice.expenses.map((expense) => ({
        ...expense,
        path: `groups/${slice.group.id}/expenses/${expense.id}`,
      }))
    ),
    ...adHocExpenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
      timestamp: expense.timestamp,
      paidById: expense.paidByFriendId,
      splits: expense.splits,
      transactionFingerprint: expense.transactionFingerprint,
      path: `users/${candidate.userId}/adhocExpenses/${expense.id}`,
    })),
  ];
  const candidates = findDuplicateExpenseCandidates({
    draft,
    existingExpenses: existing,
    transactionFingerprint: buildDuplicateFingerprint({
      date,
      description: candidate.merchant,
      amount: candidate.amount,
      currency: candidate.currency,
    }),
  });
  const strongest = candidates[0];
  if (!strongest) return { duplicateConfidence: 0 };
  const duplicateConfidence = clamp(strongest.score / 10);
  return {
    duplicateConfidence,
    status: strongest.strength === "hard" ? "duplicate" : undefined,
    matchingExpenseId: strongest.expense.id,
    matchingExpensePath:
      (strongest.expense as ExistingExpenseWithPath).path ?? undefined,
  };
}

export function buildTransactionFingerprint(params: {
  merchant: string;
  amount: number;
  currency: string;
  transactionAt: number;
  sourceSender?: string;
}): string {
  return [
    dateKey(params.transactionAt),
    normalizeMerchant(params.merchant),
    Math.round(Math.abs(params.amount) * 100),
    params.currency.toUpperCase(),
    normalizeSender(params.sourceSender ?? ""),
  ].join("|");
}

export function normalizeMerchant(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\b(?:pvt|ltd|private|limited|payments?|online|india|upi|pos)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function statusLabel(status: TransactionCandidateStatus): string {
  const labels: Record<TransactionCandidateStatus, string> = {
    new: "Needs context",
    suggested: "Suggested",
    added: "Added",
    personal: "Personal",
    ignored: "Ignored",
    duplicate: "Duplicate",
    expired: "Expired",
  };
  return labels[status];
}

export function reasonLabel(code: TransactionRadarReasonCode): string {
  const labels: Record<TransactionRadarReasonCode, string> = {
    active_trip_dates: "transaction happened during active trip dates",
    merchant_seen_in_group: "merchant was previously split in this group",
    same_currency_as_group: "currency matches the group",
    recent_group_activity: "group had recent activity",
    user_rule_match: "matched a one-tap rule",
    friend_recently_split: "friend was recently involved in a similar split",
    category_common_for_group: "category is common for this group",
  };
  return labels[code];
}

function suggestTarget(input: CandidateContextInput): TransactionSuggestedTarget | undefined {
  const ruleTarget = suggestFromRules(input.candidate, input.rules, input.groupSlices, input.friends);
  if (ruleTarget) return ruleTarget;

  const groupTarget = bestGroupTarget(input.candidate, input.groupSlices);
  const friendTarget = bestFriendTarget(input.candidate, input.friends, input.adHocExpenses);
  if (!groupTarget) return friendTarget;
  if (!friendTarget) return groupTarget;
  return groupTarget.confidence >= friendTarget.confidence ? groupTarget : friendTarget;
}

function suggestFromRules(
  candidate: TransactionCandidate,
  rules: TransactionRule[],
  groupSlices: GroupContextSlice[],
  friends: Friend[]
): TransactionSuggestedTarget | undefined {
  const merchant = candidate.normalizedMerchant;
  const sender = normalizeSender(candidate.sourceSender);
  for (const rule of rules) {
    if (rule.status === "paused") continue;
    if (rule.currency && rule.currency !== candidate.currency) continue;
    if (rule.amountMin !== undefined && candidate.amount < rule.amountMin) continue;
    if (rule.amountMax !== undefined && candidate.amount > rule.amountMax) continue;
    if (
      rule.merchantPattern &&
      !merchant.includes(normalizeMerchant(rule.merchantPattern))
    ) {
      continue;
    }
    if (
      rule.senderPattern &&
      !sender.includes(normalizeSender(rule.senderPattern))
    ) {
      continue;
    }
    if (!rule.targetKind || !rule.targetId) continue;
    if (rule.targetKind === "group") {
      const group = groupSlices.find((slice) => slice.group.id === rule.targetId);
      if (!group || group.group.status === "archived") continue;
      return {
        kind: "group",
        targetId: group.group.id,
        targetName: group.group.name,
        reasonCodes: ["user_rule_match"],
        confidence: 0.94,
      };
    }
    const friend = friends.find((item) => item.id === rule.targetId);
    if (!friend) continue;
    return {
      kind: "friend",
      targetId: friend.id,
      targetName: friend.name,
      reasonCodes: ["user_rule_match"],
      confidence: 0.9,
    };
  }
  return undefined;
}

function bestGroupTarget(
  candidate: TransactionCandidate,
  groupSlices: GroupContextSlice[]
): TransactionSuggestedTarget | undefined {
  const scored = groupSlices
    .filter((slice) => slice.group.status !== "archived")
    .map((slice) => {
      const reasonCodes: TransactionRadarReasonCode[] = [];
      let score = 0;
      if (
        slice.group.travelMode &&
        isWithinActiveWindow(candidate.transactionAt, slice.group)
      ) {
        score += 0.36;
        reasonCodes.push("active_trip_dates");
      }
      if (slice.group.defaultCurrency === candidate.currency || slice.group.settlementCurrency === candidate.currency) {
        score += 0.14;
        reasonCodes.push("same_currency_as_group");
      }
      if (slice.expenses.some((expense) => normalizeMerchant(expense.description).includes(candidate.normalizedMerchant))) {
        score += 0.24;
        reasonCodes.push("merchant_seen_in_group");
      }
      if (slice.expenses.some((expense) => Date.now() - expense.timestamp < 14 * MILLIS_PER_DAY)) {
        score += 0.12;
        reasonCodes.push("recent_group_activity");
      }
      if (
        slice.expenses.some((expense) => {
          const cat = suggestExpenseCategory(expense.description)?.categorySlug;
          return cat && cat === candidate.category;
        })
      ) {
        score += 0.1;
        reasonCodes.push("category_common_for_group");
      }
      const templateBoost = ["trip", "flatmates", "office", "event"].includes(slice.group.template ?? "")
        ? 0.05
        : 0;
      return {
        target: {
          kind: "group" as const,
          targetId: slice.group.id,
          targetName: slice.group.name,
          reasonCodes,
          confidence: clamp(score + templateBoost),
        },
      };
    })
    .filter(({ target }) => target.confidence >= 0.28)
    .sort((a, b) => b.target.confidence - a.target.confidence);
  return scored[0]?.target;
}

function bestFriendTarget(
  candidate: TransactionCandidate,
  friends: Friend[],
  adHocExpenses: AdHocExpense[]
): TransactionSuggestedTarget | undefined {
  const recentByFriend = new Map<string, number>();
  for (const expense of adHocExpenses) {
    const participantId =
      expense.paidByFriendId === YOU_ID
        ? Object.keys(expense.splits).find((id) => id !== YOU_ID)
        : expense.paidByFriendId;
    if (!participantId) continue;
    if (!normalizeMerchant(expense.description).includes(candidate.normalizedMerchant)) continue;
    recentByFriend.set(participantId, Math.max(recentByFriend.get(participantId) ?? 0, expense.timestamp));
  }
  const best = Array.from(recentByFriend.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!best) return undefined;
  const friend = friends.find((item) => item.id === best[0]);
  if (!friend) return undefined;
  return {
    kind: "friend",
    targetId: friend.id,
    targetName: friend.name,
    reasonCodes: ["friend_recently_split"],
    confidence: Date.now() - best[1] < 30 * MILLIS_PER_DAY ? 0.55 : 0.36,
  };
}

function buildSuggestedSplit(
  target: TransactionSuggestedTarget,
  groupSlices: GroupContextSlice[],
  friends: Friend[]
): TransactionSuggestedSplit {
  if (target.kind === "group") {
    const slice = groupSlices.find((item) => item.group.id === target.targetId);
    return {
      splitType: "EQUAL",
      participantIds: slice?.members.map((member) => member.id) ?? [],
    };
  }
  const friend = friends.find((item) => item.id === target.targetId);
  return {
    splitType: "EQUAL" satisfies SplitType,
    participantIds: [YOU_ID, friend?.id ?? target.targetId],
  };
}

function firstMoneyMatch(text: string): { amount: number; currency: string; index: number } | null {
  const match = MONEY_RE.exec(text);
  if (!match) return null;
  const rawAmount = match[1] ?? match[2];
  const amount = Number(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const raw = match[0].toLowerCase();
  const currency =
    raw.includes("₹") || raw.includes("rs") || raw.includes("inr")
      ? "INR"
      : raw.includes("€") || raw.includes("eur")
        ? "EUR"
        : raw.includes("£") || raw.includes("gbp")
          ? "GBP"
          : raw.includes("cad")
            ? "CAD"
            : raw.includes("aud")
              ? "AUD"
              : raw.includes("¥") || raw.includes("jpy")
                ? "JPY"
                : "USD";
  return { amount, currency, index: match.index };
}

function classifyCandidate(text: string): TransactionCandidateType {
  if (/\b(?:refund|reversal|credited|cashback received)\b/i.test(text)) return "refund";
  if (/\b(?:sent|transfer(?:red)?|neft|imps|rtgs|upi transfer)\b/i.test(text)) return "transfer";
  if (/\b(?:atm|cash withdrawal)\b/i.test(text)) return "cash-withdrawal";
  if (/\b(?:spent|debited|charged|paid|purchase|payment|receipt)\b/i.test(text)) return "spend";
  return "unknown";
}

function deriveMerchant(text: string, sender: string, amountIndex: number): string {
  const patterns = [
    /\b(?:at|to|towards|on)\s+([A-Z0-9][A-Za-z0-9 &.'-]{2,60})/i,
    /\b(?:merchant|payee|biller)\s*[:\-]\s*([A-Z0-9][A-Za-z0-9 &.'-]{2,60})/i,
    /\b(?:from)\s+([A-Z0-9][A-Za-z0-9 &.'-]{2,60})\s+(?:for|of)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanMerchant(match[1]);
  }
  const window = text.slice(Math.max(0, amountIndex - 80), amountIndex + 120);
  const titleCase = /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})\b/.exec(window);
  if (titleCase?.[1] && !/dear|card|account|transaction|payment/i.test(titleCase[1])) {
    return cleanMerchant(titleCase[1]);
  }
  return cleanMerchant(sender.split("@")[0].replace(/[._-]+/g, " "));
}

function deriveTransactionTime(text: string, fallback: number): number {
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  const dmy = /\b(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](20\d{2})\b/.exec(text);
  if (dmy) {
    const month = monthIndex(dmy[2]);
    const date = new Date(Number(dmy[3]), month, Number(dmy[1]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return fallback;
}

function derivePaymentInstrumentHint(text: string): string | undefined {
  const card = /\b(?:card|xx|ending)\s*(?:no\.?|number)?\s*(?:ending)?\s*(?:with|in)?\s*(?:x{2,}|[*]+)?\s*(\d{4})\b/i.exec(text);
  if (card?.[1]) return `Card ending ${card[1]}`;
  if (/\bupi\b/i.test(text)) return "UPI";
  if (/\bnetbanking|net banking\b/i.test(text)) return "NetBanking";
  return undefined;
}

function isWithinActiveWindow(timestamp: number, group: Group): boolean {
  const start = group.tripStartAt ?? group.createdAt;
  const end = group.tripEndAt ?? Date.now() + 7 * MILLIS_PER_DAY;
  return timestamp >= start - MILLIS_PER_DAY && timestamp <= end + MILLIS_PER_DAY;
}

function cleanMerchant(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\b(?:for|of|using|via|on|dated|ref|txn|transaction).*$/i, "")
    .replace(/[^A-Za-z0-9 &.'-]+$/g, "")
    .trim()
    .slice(0, 80);
}

function normalizeSender(value: string): string {
  return value.toLowerCase().replace(/^.*<|>.*$/g, "").trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthIndex(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric - 1);
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((item) =>
    value.toLowerCase().startsWith(item)
  );
  return Math.max(0, idx);
}

function redactSnippet(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\b\d{10,}\b/g, "[number]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .slice(0, 260);
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
