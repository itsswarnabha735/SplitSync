import type {
  AdHocPayment,
  AdHocExpense,
  Expense,
  Group,
  GroupMember,
  Payment,
  RecurringExpense,
  SettlementRequest,
} from "@/lib/models";
import { YOU_ID } from "@/lib/models";

export function groupMemberForUid(
  members: GroupMember[],
  uid: string | null | undefined
): GroupMember | undefined {
  if (!uid) return undefined;
  return members.find((member) => member.linkedUid === uid);
}

export function canEditGroupProfile(
  group: Group | null | undefined,
  uid: string | null | undefined
): boolean {
  return Boolean(uid && group?.memberUids.includes(uid));
}

export function canEditGroupExpense(
  params: {
    group: Group | null | undefined;
    members: GroupMember[];
    expense: Pick<Expense, "createdByUid" | "paidById">;
    uid: string | null | undefined;
  }
): boolean {
  return canEditGroupRow({
    group: params.group,
    members: params.members,
    uid: params.uid,
    createdByUid: params.expense.createdByUid,
    payerMemberId: params.expense.paidById,
  });
}

export function canDeleteGroupExpense(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  expense: Pick<Expense, "createdByUid" | "paidById">;
  uid: string | null | undefined;
}): boolean {
  return canEditGroupExpense(params);
}

export function canEditGroupPayment(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  payment: Pick<Payment, "createdByUid" | "fromMemberId">;
  uid: string | null | undefined;
}): boolean {
  return canEditGroupRow({
    group: params.group,
    members: params.members,
    uid: params.uid,
    createdByUid: params.payment.createdByUid,
    payerMemberId: params.payment.fromMemberId,
  });
}

export function canDeleteGroupPayment(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  payment: Pick<Payment, "createdByUid" | "fromMemberId">;
  uid: string | null | undefined;
}): boolean {
  return canEditGroupPayment(params);
}

export function canEditRecurringExpense(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  recurring: Pick<RecurringExpense, "createdByUid" | "paidById">;
  uid: string | null | undefined;
}): boolean {
  return canEditGroupRow({
    group: params.group,
    members: params.members,
    uid: params.uid,
    createdByUid: params.recurring.createdByUid,
    payerMemberId: params.recurring.paidById,
  });
}

export function canDeleteRecurringExpense(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  recurring: Pick<RecurringExpense, "createdByUid" | "paidById">;
  uid: string | null | undefined;
}): boolean {
  return canEditRecurringExpense(params);
}

export function canEditSettlementRequest(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  request: Pick<SettlementRequest, "requestedByUid" | "fromMemberId">;
  uid: string | null | undefined;
}): boolean {
  return canEditGroupRow({
    group: params.group,
    members: params.members,
    uid: params.uid,
    createdByUid: params.request.requestedByUid,
    payerMemberId: params.request.fromMemberId,
  });
}

export function canDeleteSettlementRequest(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  request: Pick<SettlementRequest, "requestedByUid" | "fromMemberId">;
  uid: string | null | undefined;
}): boolean {
  return canEditSettlementRequest(params);
}

export function canEditAdHocExpense(
  expense: Pick<AdHocExpense, "createdByUid" | "paidByFriendId"> | null | undefined,
  uid: string | null | undefined
): boolean {
  if (!uid || !expense) return false;
  return expense.createdByUid === uid || expense.paidByFriendId === YOU_ID;
}

export function canDeleteAdHocExpense(
  expense:
    | Pick<AdHocExpense, "createdByUid" | "paidByFriendId" | "mirroredFromPath">
    | null
    | undefined,
  uid: string | null | undefined
): boolean {
  if (!uid || !expense) return false;
  return (
    expense.createdByUid === uid ||
    expense.paidByFriendId === YOU_ID ||
    (!expense.createdByUid && !expense.mirroredFromPath)
  );
}

export function canDeleteAdHocPayment(
  payment:
    | Pick<AdHocPayment, "createdByUid" | "fromFriendId" | "mirroredFromPath">
    | null
    | undefined,
  uid: string | null | undefined
): boolean {
  if (!uid || !payment) return false;
  return (
    payment.createdByUid === uid ||
    payment.fromFriendId === YOU_ID ||
    (!payment.createdByUid && !payment.mirroredFromPath)
  );
}

export function canEditAdHocPayment(
  payment:
    | Pick<AdHocPayment, "createdByUid" | "fromFriendId" | "mirroredFromPath">
    | null
    | undefined,
  uid: string | null | undefined
): boolean {
  return canDeleteAdHocPayment(payment, uid);
}

function canEditGroupRow(params: {
  group: Group | null | undefined;
  members: GroupMember[];
  uid: string | null | undefined;
  createdByUid?: string;
  payerMemberId: string;
}): boolean {
  const { group, members, uid, createdByUid, payerMemberId } = params;
  if (!uid || !group?.memberUids.includes(uid)) return false;
  if (createdByUid) return createdByUid === uid || memberIsLinkedToUid(members, payerMemberId, uid);
  return group.createdBy === uid || memberIsLinkedToUid(members, payerMemberId, uid);
}

function memberIsLinkedToUid(
  members: GroupMember[],
  memberId: string,
  uid: string
): boolean {
  return members.some((member) => member.id === memberId && member.linkedUid === uid);
}
