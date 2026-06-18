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

/**
 * Stable sentinel used inside ad-hoc collections to represent the signed-in
 * user themselves (mirrors `YOU_ID` from the Kotlin model).
 */
export const YOU_ID = "self" as const;

export type SplitType = "EQUAL" | "EXACT";

export interface Group {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  createdBy: string;
  /** Flat array of every member uid currently in the group; drives access rules. */
  memberUids: string[];
}

export interface GroupMember {
  id: string;
  groupId: string;
  name: string;
  email: string;
  /** uid of a SplitSync user this member is linked to, when one exists. */
  linkedUid: string;
}

export interface Expense {
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
}

export interface Payment {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  timestamp: number;
  currency: string;
}

export interface Friend {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: number;
  /** uid of a SplitSync user this friend is linked to, when one exists. */
  linkedUid: string;
}

export interface AdHocExpense {
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
}

export interface AdHocPayment {
  id: string;
  fromFriendId: string;
  toFriendId: string;
  amount: number;
  timestamp: number;
  currency: string;
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
