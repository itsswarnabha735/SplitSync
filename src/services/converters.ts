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
  Notification,
  NotificationPreference,
  NotificationType,
  Payment,
  SplitType,
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
  ];
  return typeof v === "string" && known.includes(v as NotificationType)
    ? (v as NotificationType)
    : "group_expense_created";
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
    createdByUid: str(data.createdByUid) || undefined,
    category: category(data.category),
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
