/**
 * TypeScript domain models ported 1:1 from the Android app's
 * `data/model/Models.kt`. The Firestore schema is unchanged, so these
 * interfaces map directly onto the same collections/documents:
 *
 *   /groups/{groupId}
 *   /groups/{groupId}/members/{memberId}
 *   /groups/{groupId}/expenses/{expenseId}   (splits embedded as Record<memberId, amount>)
 *   /groups/{groupId}/payments/{paymentId}
 *
 *   /users/{uid}/friends/{friendId}
 *   /users/{uid}/adhocExpenses/{expenseId}   (splits embedded as Record<participantId, amount>)
 *   /users/{uid}/adhocPayments/{paymentId}
 *   /users/{uid}/groupInvites/{groupId}
 */

import type { ExpenseCategorySlug } from "@/lib/expense-categories";

/**
 * Stable sentinel used inside ad-hoc collections to represent the signed-in
 * user themselves (mirrors `YOU_ID` from the Kotlin model).
 */
export const YOU_ID = "self" as const;

export type SplitType = "EQUAL" | "EXACT";
export type GroupTemplate =
  | "custom"
  | "trip"
  | "flatmates"
  | "couple"
  | "office"
  | "event";
export type PaymentMethod = "upi" | "bank" | "cash" | "other";
export type RecurringFrequency = "weekly" | "monthly" | "quarterly" | "yearly";
export type ExpenseDisputeStatus = "none" | "needs_clarification" | "resolved";
export type ExpenseSourceType =
  | "statement-import"
  | "ai-text"
  | "pasted-message"
  | "receipt-image"
  | "manual";
export type StatementParserMode = "ai-assisted" | "local-only";

export interface ExpenseImportProvenance {
  /** Present when this expense was created from an imported statement row. */
  sourceType?: ExpenseSourceType;
  /** Client-generated id shared by every expense from the same import run. */
  importBatchId?: string;
  /** Deterministic row fingerprint used to warn about duplicate imports. */
  transactionFingerprint?: string;
  /** Whether parsing used Gemini or local regex/OCR only. */
  parserMode?: StatementParserMode;
  /** Parser confidence for the imported row, when available. */
  parserConfidence?: number;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  createdBy: string;
  /** Flat array of every member uid currently in the group; drives access rules. */
  memberUids: string[];
  status?: "active" | "archived";
  archivedAt?: number;
  archivedByUid?: string;
  template?: GroupTemplate;
  defaultCurrency?: string;
  settlementCurrency?: string;
  travelMode?: boolean;
}

export interface GroupMember {
  id: string;
  groupId: string;
  name: string;
  email: string;
  /** uid of a SplitSync user this member is linked to, when one exists. */
  linkedUid: string;
  preferredPaymentMethod?: PaymentMethod;
  paymentHandle?: string;
  paymentLink?: string;
}

export interface ExpenseFxMetadata {
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  fxNote?: string;
}

export interface ExpenseDisputeMetadata {
  disputeStatus?: ExpenseDisputeStatus;
  disputedByUid?: string;
  disputedAt?: number;
  disputeNote?: string;
}

export interface Expense
  extends ExpenseImportProvenance,
    ExpenseFxMetadata,
    ExpenseDisputeMetadata {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidById: string;
  splitType: SplitType;
  timestamp: number;
  currency: string;
  /** Embedded splits: memberId -> portion owed. */
  splits: Record<string, number>;
  /** uid of the user who created the ledger entry. */
  createdByUid?: string;
  /** Optional recognized category for imported or manually categorized expenses. */
  category?: ExpenseCategorySlug;
  notes?: string;
  sourceConfidence?: number;
  sourceWarnings?: string[];
  createdAt?: number;
  updatedAt?: number;
  lastEditedByUid?: string;
  editCount?: number;
}

export interface ExpenseComment {
  id: string;
  groupId: string;
  expenseId: string;
  body: string;
  createdAt: number;
  createdByUid: string;
  createdByName: string;
}

export interface RecurringExpense extends ExpenseFxMetadata {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  paidById: string;
  splitType: SplitType;
  currency: string;
  splits: Record<string, number>;
  category?: ExpenseCategorySlug;
  frequency: RecurringFrequency;
  nextDueAt: number;
  active: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  lastPostedAt?: number;
}

export interface Payment {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  timestamp: number;
  currency: string;
  /** uid of the user who recorded the settlement. */
  createdByUid?: string;
  updatedAt?: number;
  lastEditedByUid?: string;
  editCount?: number;
}

export type SettlementRequestStatus =
  | "requested"
  | "reminded"
  | "dismissed"
  | "settled";

export interface SettlementRequest {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  message: string;
  status: SettlementRequestStatus;
  createdAt: number;
  updatedAt: number;
  requestedByUid: string;
  lastRemindedAt?: number;
  remindAfter?: number;
}

export interface Friend {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: number;
  /** uid of a SplitSync user this friend is linked to, when one exists. */
  linkedUid: string;
  /** uid of the user who created this friend row. */
  createdByUid?: string;
}

export interface AdHocExpense extends ExpenseImportProvenance {
  id: string;
  description: string;
  amount: number;
  /** YOU_ID for the signed-in user; otherwise a Friend.id. */
  paidByFriendId: string;
  splitType: SplitType;
  timestamp: number;
  currency: string;
  /** Embedded splits: participantId -> portion owed. */
  splits: Record<string, number>;
  /** uid of the user who created the ledger entry. */
  createdByUid?: string;
  /** Optional recognized category for imported or manually categorized expenses. */
  category?: ExpenseCategorySlug;
  notes?: string;
  sourceConfidence?: number;
  sourceWarnings?: string[];
  createdAt?: number;
  updatedAt?: number;
  lastEditedByUid?: string;
  editCount?: number;
  /** Present on server-created mirror docs in a linked friend's ledger. */
  mirroredFromPath?: string;
  mirroredFromUid?: string;
  originalId?: string;
}

export interface AdHocPayment {
  id: string;
  fromFriendId: string;
  toFriendId: string;
  amount: number;
  timestamp: number;
  currency: string;
  /** uid of the user who recorded the settlement. */
  createdByUid?: string;
  updatedAt?: number;
  lastEditedByUid?: string;
  editCount?: number;
  /** Present on server-created mirror docs in a linked friend's ledger. */
  mirroredFromPath?: string;
  mirroredFromUid?: string;
  originalId?: string;
}

export interface GroupInvite {
  id: string;
  groupId: string;
  groupName: string;
  invitedByUid: string;
  invitedByName: string;
  invitedAt: number;
}

// ---------------------------------------------------------------------------
// Non-entity view models (derived; never persisted directly).
// ---------------------------------------------------------------------------

export interface GroupWithMembersAndStats {
  group: Group;
  members: GroupMember[];
  totalExpense: number;
  pendingSettlementsCount: number;
}

export interface MemberBalanceInfo {
  member: GroupMember;
  currency: string;
  initialPaid: number;
  initialOwe: number;
  paymentsMadeAsSender: number;
  paymentsMadeAsReceiver: number;
}

/** Net balance for a member: positive => they are owed, negative => they owe. */
export function netBalance(b: MemberBalanceInfo): number {
  return (
    b.initialPaid +
    b.paymentsMadeAsSender -
    (b.initialOwe + b.paymentsMadeAsReceiver)
  );
}

export interface DebtOverview {
  debtor: GroupMember;
  creditor: GroupMember;
  amount: number;
  currency: string;
}

export interface FriendWithBalance {
  friend: Friend;
  netBalance: number;
  currency: string;
}

export interface AdHocSplit {
  id: string;
  adhocExpenseId: string;
  participantFriendId: string;
  amount: number;
}

export type NotificationType =
  | "group_invite_received"
  | "group_invite_accepted"
  | "group_expense_created"
  | "group_expense_deleted"
  | "group_settlement_created"
  | "group_settlement_deleted"
  | "group_fully_settled"
  | "friend_added"
  | "adhoc_expense_created"
  | "adhoc_expense_deleted"
  | "adhoc_settlement_created"
  | "adhoc_settlement_deleted";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  actorUid: string;
  targetUrl: string;
  createdAt: number;
  readAt: number | null;
  eventId: string;
  source: {
    collection: string;
    id: string;
    groupId?: string;
    currency?: string;
    amount?: number;
    tags?: string[];
  };
}

export type NotificationChannelPreference = {
  inApp?: boolean;
  push?: boolean;
};

export interface NotificationPreference {
  pushEnabled: boolean;
  eventChannels: Partial<Record<NotificationType, NotificationChannelPreference>>;
  largeExpenseThresholds: Record<string, number>;
  updatedAt: number;
}

export interface FcmToken {
  id: string;
  token: string;
  deviceLabel: string;
  userAgent: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
}
