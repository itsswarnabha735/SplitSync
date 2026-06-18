import type {
  DocumentData,
  QueryDocumentSnapshot,
  DocumentSnapshot,
} from "firebase/firestore";

import {
  AdHocExpense,
  AdHocPayment,
  Expense,
  Friend,
  Group,
  GroupInvite,
  GroupMember,
  Payment,
  SplitType,
} from "@/lib/models";

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
