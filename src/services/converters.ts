import type {
  DocumentData,
  QueryDocumentSnapshot,
  DocumentSnapshot,
} from "firebase/firestore";

import {
  AdHocExpense,
  AdHocPayment,
  Expense,
  ExpenseComment,
  ExpenseDisputeStatus,
  Friend,
  Group,
  GroupTemplate,
  GroupInvite,
  GroupMember,
  Notification,
  NotificationPreference,
  NotificationType,
  PaymentMethod,
  Payment,
  RecurringExpense,
  RecurringFrequency,
  SettlementRequest,
  SettlementRequestStatus,
  ExpenseSourceType,
  StatementParserMode,
  SplitType,
  TransactionCandidate,
  TransactionCandidateStatus,
  TransactionCandidateType,
  TransactionRadarReasonCode,
  TransactionRadarRawRetention,
  TransactionRadarScanStatus,
  TransactionRadarSettings,
  TransactionRule,
  TransactionRuleSplitPreset,
  TransactionRuleStatus,
  TransactionRuleTargetKind,
  TransactionSuggestedTargetKind,
} from "@/lib/models";
import { isExpenseCategorySlug } from "@/lib/expense-categories";

type AnySnap = QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>;

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function splitMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "number") out[k] = val;
  }
  return out;
}
function splitType(v: unknown): SplitType {
  return v === "EXACT" ? "EXACT" : "EQUAL";
}
function category(v: unknown) {
  return isExpenseCategorySlug(v) ? v : undefined;
}
function sourceType(v: unknown): ExpenseSourceType | undefined {
  const known: ExpenseSourceType[] = [
    "statement-import",
    "ai-text",
    "pasted-message",
    "receipt-image",
    "gmail",
    "manual",
  ];
  return typeof v === "string" && known.includes(v as ExpenseSourceType)
    ? (v as ExpenseSourceType)
    : undefined;
}
function parserMode(v: unknown): StatementParserMode | undefined {
  return v === "ai-assisted" || v === "local-only" ? v : undefined;
}
function groupTemplate(v: unknown): GroupTemplate {
  const known: GroupTemplate[] = [
    "custom",
    "trip",
    "flatmates",
    "couple",
    "office",
    "event",
  ];
  return typeof v === "string" && known.includes(v as GroupTemplate)
    ? (v as GroupTemplate)
    : "custom";
}
function paymentMethod(v: unknown): PaymentMethod | undefined {
  const known: PaymentMethod[] = ["upi", "bank", "cash", "other"];
  return typeof v === "string" && known.includes(v as PaymentMethod)
    ? (v as PaymentMethod)
    : undefined;
}
function recurringFrequency(v: unknown): RecurringFrequency {
  const known: RecurringFrequency[] = ["weekly", "monthly", "quarterly", "yearly"];
  return typeof v === "string" && known.includes(v as RecurringFrequency)
    ? (v as RecurringFrequency)
    : "monthly";
}
function expenseDisputeStatus(v: unknown): ExpenseDisputeStatus {
  const known: ExpenseDisputeStatus[] = [
    "none",
    "needs_clarification",
    "resolved",
  ];
  return typeof v === "string" && known.includes(v as ExpenseDisputeStatus)
    ? (v as ExpenseDisputeStatus)
    : "none";
}
function settlementRequestStatus(v: unknown): SettlementRequestStatus {
  const known: SettlementRequestStatus[] = [
    "requested",
    "reminded",
    "dismissed",
    "settled",
  ];
  return typeof v === "string" && known.includes(v as SettlementRequestStatus)
    ? (v as SettlementRequestStatus)
    : "requested";
}
function notificationType(v: unknown): NotificationType {
  const known: NotificationType[] = [
    "group_invite_received",
    "group_invite_accepted",
    "group_expense_created",
    "group_expense_deleted",
    "group_settlement_created",
    "group_settlement_deleted",
    "group_fully_settled",
    "friend_added",
    "adhoc_expense_created",
    "adhoc_expense_deleted",
    "adhoc_settlement_created",
    "adhoc_settlement_deleted",
    "transaction_candidate_detected",
  ];
  return typeof v === "string" && known.includes(v as NotificationType)
    ? (v as NotificationType)
    : "group_expense_created";
}
function candidateType(v: unknown): TransactionCandidateType {
  const known: TransactionCandidateType[] = [
    "spend",
    "refund",
    "transfer",
    "cash-withdrawal",
    "unknown",
  ];
  return typeof v === "string" && known.includes(v as TransactionCandidateType)
    ? (v as TransactionCandidateType)
    : "unknown";
}
function candidateStatus(v: unknown): TransactionCandidateStatus {
  const known: TransactionCandidateStatus[] = [
    "new",
    "suggested",
    "added",
    "personal",
    "ignored",
    "duplicate",
    "expired",
  ];
  return typeof v === "string" && known.includes(v as TransactionCandidateStatus)
    ? (v as TransactionCandidateStatus)
    : "new";
}
function suggestedTargetKind(v: unknown): TransactionSuggestedTargetKind {
  return v === "friend" ? "friend" : "group";
}
function reasonCodes(v: unknown): TransactionRadarReasonCode[] {
  const known: TransactionRadarReasonCode[] = [
    "active_trip_dates",
    "merchant_seen_in_group",
    "same_currency_as_group",
    "recent_group_activity",
    "user_rule_match",
    "friend_recently_split",
    "category_common_for_group",
  ];
  return Array.isArray(v)
    ? (v.filter(
        (item): item is TransactionRadarReasonCode =>
          typeof item === "string" &&
          known.includes(item as TransactionRadarReasonCode)
      ))
    : [];
}
function suggestedTarget(v: unknown): TransactionCandidate["suggestedTarget"] {
  if (!v || typeof v !== "object") return undefined;
  const data = v as Record<string, unknown>;
  const targetId = str(data.targetId);
  if (!targetId) return undefined;
  return {
    kind: suggestedTargetKind(data.kind),
    targetId,
    targetName: str(data.targetName),
    reasonCodes: reasonCodes(data.reasonCodes),
    confidence:
      typeof data.confidence === "number"
        ? Math.max(0, Math.min(1, data.confidence))
        : 0,
  };
}
function suggestedSplit(v: unknown): TransactionCandidate["suggestedSplit"] {
  if (!v || typeof v !== "object") return undefined;
  const data = v as Record<string, unknown>;
  return {
    splitType: splitType(data.splitType),
    participantIds: stringArray(data.participantIds),
  };
}
function ruleStatus(v: unknown): TransactionRuleStatus {
  const known: TransactionRuleStatus[] = [
    "suggest_only",
    "auto_prepare",
    "auto_add_with_undo",
    "paused",
  ];
  return typeof v === "string" && known.includes(v as TransactionRuleStatus)
    ? (v as TransactionRuleStatus)
    : "suggest_only";
}
function ruleTargetKind(v: unknown): TransactionRuleTargetKind | undefined {
  return v === "group" || v === "friend" ? v : undefined;
}
function splitPreset(v: unknown): TransactionRuleSplitPreset {
  return v === "payer-only" || v === "last-used" ? v : "equal";
}
function scanStatus(v: unknown): TransactionRadarScanStatus {
  return v === "active" || v === "paused" ? v : "disconnected";
}
function rawRetention(v: unknown): TransactionRadarRawRetention {
  return v === "none" || v === "until-reviewed" ? v : "24h";
}
function stringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? (v.filter((x) => typeof x === "string") as string[])
    : [];
}
function sourceMap(v: unknown): Notification["source"] {
  if (!v || typeof v !== "object") return { collection: "", id: "" };
  const data = v as Record<string, unknown>;
  return {
    collection: str(data.collection),
    id: str(data.id),
    groupId: str(data.groupId) || undefined,
    currency: str(data.currency) || undefined,
    amount: typeof data.amount === "number" ? data.amount : undefined,
    tags: stringArray(data.tags),
  };
}
function channelMap(
  v: unknown
): NotificationPreference["eventChannels"] {
  if (!v || typeof v !== "object") return {};
  const out: NotificationPreference["eventChannels"] = {};
  for (const [key, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Record<string, unknown>;
    out[key as NotificationType] = {
      inApp: typeof value.inApp === "boolean" ? value.inApp : undefined,
      push: typeof value.push === "boolean" ? value.push : undefined,
    };
  }
  return out;
}

export function toGroup(d: AnySnap): Group {
  const data = d.data() ?? {};
  return {
    id: d.id,
    name: str(data.name),
    description: str(data.description),
    createdAt: num(data.createdAt),
    createdBy: str(data.createdBy),
    memberUids: Array.isArray(data.memberUids)
      ? (data.memberUids.filter((x) => typeof x === "string") as string[])
      : [],
    status: data.status === "archived" ? "archived" : "active",
    archivedAt: typeof data.archivedAt === "number" ? data.archivedAt : undefined,
    archivedByUid: str(data.archivedByUid) || undefined,
    template: groupTemplate(data.template),
    defaultCurrency: str(data.defaultCurrency, "USD"),
    settlementCurrency: str(
      data.settlementCurrency,
      str(data.defaultCurrency, "USD")
    ),
    travelMode: data.travelMode === true,
    tripStartAt: typeof data.tripStartAt === "number" ? data.tripStartAt : undefined,
    tripEndAt: typeof data.tripEndAt === "number" ? data.tripEndAt : undefined,
  };
}

export function toMember(d: AnySnap): GroupMember {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    name: str(data.name),
    email: str(data.email),
    linkedUid: str(data.linkedUid),
    preferredPaymentMethod: paymentMethod(data.preferredPaymentMethod),
    paymentHandle: str(data.paymentHandle) || undefined,
    paymentLink: str(data.paymentLink) || undefined,
  };
}

export function toExpense(d: AnySnap): Expense {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    description: str(data.description),
    amount: num(data.amount),
    paidById: str(data.paidById),
    splitType: splitType(data.splitType),
    timestamp: num(data.timestamp),
    currency: str(data.currency, "USD"),
    splits: splitMap(data.splits),
    createdByUid: str(data.createdByUid) || undefined,
    category: category(data.category),
    sourceType: sourceType(data.sourceType),
    importBatchId: str(data.importBatchId) || undefined,
    transactionCandidateId: str(data.transactionCandidateId) || undefined,
    transactionFingerprint: str(data.transactionFingerprint) || undefined,
    parserMode: parserMode(data.parserMode),
    parserConfidence:
      typeof data.parserConfidence === "number" ? data.parserConfidence : undefined,
    notes: str(data.notes) || undefined,
    sourceConfidence:
      typeof data.sourceConfidence === "number" ? data.sourceConfidence : undefined,
    sourceWarnings: stringArray(data.sourceWarnings),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    lastEditedByUid: str(data.lastEditedByUid) || undefined,
    editCount: typeof data.editCount === "number" ? data.editCount : undefined,
    originalAmount:
      typeof data.originalAmount === "number" ? data.originalAmount : undefined,
    originalCurrency: str(data.originalCurrency) || undefined,
    exchangeRate:
      typeof data.exchangeRate === "number" ? data.exchangeRate : undefined,
    fxNote: str(data.fxNote) || undefined,
    disputeStatus: expenseDisputeStatus(data.disputeStatus),
    disputedByUid: str(data.disputedByUid) || undefined,
    disputedAt: typeof data.disputedAt === "number" ? data.disputedAt : undefined,
    disputeNote: str(data.disputeNote) || undefined,
  };
}

export function toPayment(d: AnySnap): Payment {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    fromMemberId: str(data.fromMemberId),
    toMemberId: str(data.toMemberId),
    amount: num(data.amount),
    timestamp: num(data.timestamp),
    currency: str(data.currency, "USD"),
    createdByUid: str(data.createdByUid) || undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    lastEditedByUid: str(data.lastEditedByUid) || undefined,
    editCount: typeof data.editCount === "number" ? data.editCount : undefined,
  };
}

export function toSettlementRequest(d: AnySnap): SettlementRequest {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    fromMemberId: str(data.fromMemberId),
    toMemberId: str(data.toMemberId),
    amount: num(data.amount),
    currency: str(data.currency, "USD"),
    message: str(data.message),
    status: settlementRequestStatus(data.status),
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
    requestedByUid: str(data.requestedByUid),
    lastRemindedAt:
      typeof data.lastRemindedAt === "number" ? data.lastRemindedAt : undefined,
    remindAfter: typeof data.remindAfter === "number" ? data.remindAfter : undefined,
  };
}

export function toExpenseComment(d: AnySnap): ExpenseComment {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    expenseId: str(data.expenseId),
    body: str(data.body),
    createdAt: num(data.createdAt),
    createdByUid: str(data.createdByUid),
    createdByName: str(data.createdByName),
  };
}

export function toRecurringExpense(d: AnySnap): RecurringExpense {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    description: str(data.description),
    amount: num(data.amount),
    paidById: str(data.paidById),
    splitType: splitType(data.splitType),
    currency: str(data.currency, "USD"),
    splits: splitMap(data.splits),
    category: category(data.category),
    frequency: recurringFrequency(data.frequency),
    nextDueAt: num(data.nextDueAt),
    active: data.active !== false,
    notes: str(data.notes) || undefined,
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
    createdByUid: str(data.createdByUid),
    lastPostedAt:
      typeof data.lastPostedAt === "number" ? data.lastPostedAt : undefined,
    originalAmount:
      typeof data.originalAmount === "number" ? data.originalAmount : undefined,
    originalCurrency: str(data.originalCurrency) || undefined,
    exchangeRate:
      typeof data.exchangeRate === "number" ? data.exchangeRate : undefined,
    fxNote: str(data.fxNote) || undefined,
  };
}

export function toFriend(d: AnySnap): Friend {
  const data = d.data() ?? {};
  return {
    id: d.id,
    name: str(data.name),
    email: str(data.email),
    phone: str(data.phone),
    createdAt: num(data.createdAt),
    linkedUid: str(data.linkedUid),
    createdByUid: str(data.createdByUid) || undefined,
  };
}

export function toAdHocExpense(d: AnySnap): AdHocExpense {
  const data = d.data() ?? {};
  return {
    id: d.id,
    description: str(data.description),
    amount: num(data.amount),
    paidByFriendId: str(data.paidByFriendId, "self"),
    splitType: splitType(data.splitType),
    timestamp: num(data.timestamp),
    currency: str(data.currency, "USD"),
    splits: splitMap(data.splits),
    createdByUid: str(data.createdByUid) || undefined,
    category: category(data.category),
    sourceType: sourceType(data.sourceType),
    importBatchId: str(data.importBatchId) || undefined,
    transactionCandidateId: str(data.transactionCandidateId) || undefined,
    transactionFingerprint: str(data.transactionFingerprint) || undefined,
    parserMode: parserMode(data.parserMode),
    parserConfidence:
      typeof data.parserConfidence === "number" ? data.parserConfidence : undefined,
    notes: str(data.notes) || undefined,
    sourceConfidence:
      typeof data.sourceConfidence === "number" ? data.sourceConfidence : undefined,
    sourceWarnings: stringArray(data.sourceWarnings),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    lastEditedByUid: str(data.lastEditedByUid) || undefined,
    editCount: typeof data.editCount === "number" ? data.editCount : undefined,
    mirroredFromPath: str(data.mirroredFromPath) || undefined,
    mirroredFromUid: str(data.mirroredFromUid) || undefined,
    originalId: str(data.originalId) || undefined,
  };
}

export function toAdHocPayment(d: AnySnap): AdHocPayment {
  const data = d.data() ?? {};
  return {
    id: d.id,
    fromFriendId: str(data.fromFriendId, "self"),
    toFriendId: str(data.toFriendId, "self"),
    amount: num(data.amount),
    timestamp: num(data.timestamp),
    currency: str(data.currency, "USD"),
    createdByUid: str(data.createdByUid) || undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    lastEditedByUid: str(data.lastEditedByUid) || undefined,
    editCount: typeof data.editCount === "number" ? data.editCount : undefined,
    mirroredFromPath: str(data.mirroredFromPath) || undefined,
    mirroredFromUid: str(data.mirroredFromUid) || undefined,
    originalId: str(data.originalId) || undefined,
  };
}

export function toInvite(d: AnySnap): GroupInvite {
  const data = d.data() ?? {};
  return {
    id: d.id,
    groupId: str(data.groupId),
    groupName: str(data.groupName),
    invitedByUid: str(data.invitedByUid),
    invitedByName: str(data.invitedByName),
    invitedAt: num(data.invitedAt),
  };
}

export function toNotification(d: AnySnap): Notification {
  const data = d.data() ?? {};
  return {
    id: d.id,
    type: notificationType(data.type),
    title: str(data.title),
    body: str(data.body),
    actorUid: str(data.actorUid),
    targetUrl: str(data.targetUrl, "/dashboard"),
    createdAt: num(data.createdAt),
    readAt: data.readAt === null ? null : num(data.readAt, 0) || null,
    eventId: str(data.eventId),
    source: sourceMap(data.source),
  };
}

export function toNotificationPreference(d: AnySnap): NotificationPreference {
  const data = d.data() ?? {};
  return {
    pushEnabled: data.pushEnabled === true,
    eventChannels: channelMap(data.eventChannels),
    largeExpenseThresholds: splitMap(data.largeExpenseThresholds),
    updatedAt: num(data.updatedAt),
  };
}

export function toTransactionCandidate(d: AnySnap): TransactionCandidate {
  const data = d.data() ?? {};
  return {
    id: d.id,
    userId: str(data.userId),
    source: "gmail",
    sourceMessageId: str(data.sourceMessageId),
    sourceThreadId: str(data.sourceThreadId),
    sourceSender: str(data.sourceSender),
    sourceSubjectHash: str(data.sourceSubjectHash),
    rawSnippetRedacted: str(data.rawSnippetRedacted),
    merchant: str(data.merchant),
    normalizedMerchant: str(data.normalizedMerchant),
    amount: num(data.amount),
    currency: str(data.currency, "USD"),
    transactionAt: num(data.transactionAt),
    detectedAt: num(data.detectedAt),
    paymentInstrumentHint: str(data.paymentInstrumentHint) || undefined,
    category: category(data.category),
    candidateType: candidateType(data.candidateType),
    status: candidateStatus(data.status),
    confidence: num(data.confidence),
    parseConfidence: num(data.parseConfidence),
    contextConfidence: num(data.contextConfidence),
    duplicateConfidence: num(data.duplicateConfidence),
    suggestedTarget: suggestedTarget(data.suggestedTarget),
    suggestedSplit: suggestedSplit(data.suggestedSplit),
    duplicateExpensePath: str(data.duplicateExpensePath) || undefined,
    fingerprint: str(data.fingerprint),
    sourceRetentionExpiresAt: num(data.sourceRetentionExpiresAt),
    createdExpensePath: str(data.createdExpensePath) || undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
  };
}

export function toTransactionRule(d: AnySnap): TransactionRule {
  const data = d.data() ?? {};
  return {
    id: d.id,
    userId: str(data.userId),
    status: ruleStatus(data.status),
    merchantPattern: str(data.merchantPattern),
    senderPattern: str(data.senderPattern),
    category: category(data.category),
    amountMin: typeof data.amountMin === "number" ? data.amountMin : undefined,
    amountMax: typeof data.amountMax === "number" ? data.amountMax : undefined,
    currency: str(data.currency) || undefined,
    targetKind: ruleTargetKind(data.targetKind),
    targetId: str(data.targetId) || undefined,
    splitPreset: splitPreset(data.splitPreset),
    activeFrom: typeof data.activeFrom === "number" ? data.activeFrom : undefined,
    activeUntil: typeof data.activeUntil === "number" ? data.activeUntil : undefined,
    createdFromCandidateId: str(data.createdFromCandidateId) || undefined,
    lastTriggeredAt:
      typeof data.lastTriggeredAt === "number" ? data.lastTriggeredAt : undefined,
    triggerCount: num(data.triggerCount),
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
  };
}

export function toTransactionRadarSettings(
  d: AnySnap
): TransactionRadarSettings {
  const data = d.data() ?? {};
  return {
    gmailConnected: data.gmailConnected === true,
    gmailEmail: str(data.gmailEmail),
    scanStatus: scanStatus(data.scanStatus),
    retentionDays:
      typeof data.retentionDays === "number" ? data.retentionDays : 30,
    rawEmailRetention: rawRetention(data.rawEmailRetention),
    ignoredMerchants: stringArray(data.ignoredMerchants),
    activeFilters: stringArray(data.activeFilters),
    updatedAt: num(data.updatedAt),
    connectedAt:
      typeof data.connectedAt === "number" ? data.connectedAt : undefined,
    lastSyncedAt:
      typeof data.lastSyncedAt === "number" ? data.lastSyncedAt : undefined,
    lastSyncError: str(data.lastSyncError) || undefined,
    gmailWatchExpiresAt:
      typeof data.gmailWatchExpiresAt === "number"
        ? data.gmailWatchExpiresAt
        : undefined,
  };
}
