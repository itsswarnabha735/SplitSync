import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { getFirestoreDb } from "@/lib/firebase";
import { calculateFriendBalances } from "@/lib/balances";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  buildFriendIdentityIndex,
  canonicalizeAdHocExpenses,
  canonicalizeAdHocPayments,
} from "@/lib/friend-identities";
import {
  AdHocExpense,
  AdHocPayment,
  Expense,
  ExpenseComment,
  ExpenseDisputeStatus,
  ExpenseImportProvenance,
  FcmToken,
  Friend,
  Group,
  GroupTemplate,
  GroupInvite,
  GroupMember,
  Notification,
  NotificationPreference,
  PaymentMethod,
  Payment,
  RecurringExpense,
  RecurringFrequency,
  SettlementRequest,
  SettlementRequestStatus,
  SplitType,
} from "@/lib/models";
import type { SplitPair } from "@/lib/splits";
import { splitsToMap } from "@/lib/splits";
import {
  toAdHocExpense,
  toAdHocPayment,
  toExpense,
  toExpenseComment,
  toFriend,
  toGroup,
  toInvite,
  toMember,
  toNotification,
  toNotificationPreference,
  toPayment,
  toRecurringExpense,
  toSettlementRequest,
} from "./converters";

type Cb<T> = (items: T) => void;
type ErrorCb = (err: Error) => void;

/** A prospective group member supplied when creating a group. */
export interface NewGroupMember {
  name: string;
  email: string;
  /** uid of the registered SplitSync user, or "" for a name-only placeholder. */
  linkedUid: string;
}

export interface ExpenseWriteMetadata extends ExpenseImportProvenance {
  notes?: string;
  sourceConfidence?: number;
  sourceWarnings?: string[];
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  fxNote?: string;
}

export interface ExpenseUpdatePatch extends ExpenseWriteMetadata {
  description?: string;
  amount?: number;
  paidById?: string;
  splitType?: SplitType;
  splits?: SplitPair[];
  timestamp?: number;
  currency?: string;
  category?: ExpenseCategorySlug;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  fxNote?: string;
  disputeStatus?: ExpenseDisputeStatus;
  disputedByUid?: string;
  disputedAt?: number;
  disputeNote?: string;
}

export interface AdHocExpenseUpdatePatch extends ExpenseWriteMetadata {
  description?: string;
  amount?: number;
  paidByFriendId?: string;
  splitType?: SplitType;
  splits?: SplitPair[];
  timestamp?: number;
  currency?: string;
  category?: ExpenseCategorySlug;
}

export interface PaymentUpdatePatch {
  fromMemberId?: string;
  toMemberId?: string;
  amount?: number;
  timestamp?: number;
  currency?: string;
}

export interface SettlementRequestPatch {
  status?: SettlementRequestStatus;
  message?: string;
  remindAfter?: number;
  lastRemindedAt?: number;
}

export interface GroupProfilePatch {
  name?: string;
  description?: string;
  template?: GroupTemplate;
  defaultCurrency?: string;
  settlementCurrency?: string;
  travelMode?: boolean;
}

export interface MemberPaymentPatch {
  preferredPaymentMethod?: PaymentMethod;
  paymentHandle?: string;
  paymentLink?: string;
}

export interface RecurringExpenseWrite {
  groupId: string;
  description: string;
  amount: number;
  paidById: string;
  splitType: SplitType;
  splits: SplitPair[];
  currency?: string;
  category?: ExpenseCategorySlug;
  frequency: RecurringFrequency;
  nextDueAt: number;
  active?: boolean;
  notes?: string;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  fxNote?: string;
}

function snapshotError(label: string, onError?: ErrorCb) {
  return (err: Error) => {
    console.warn(`[SplitSync] ${label} listener failed:`, err.message);
    onError?.(err);
  };
}

function numberMapsEqual(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined)
  ) as T;
}

function nextRecurringDueAt(
  currentDueAt: number,
  frequency: RecurringFrequency
): number {
  const date = new Date(currentDueAt || Date.now());
  if (frequency === "weekly") date.setDate(date.getDate() + 7);
  else if (frequency === "quarterly") date.setMonth(date.getMonth() + 3);
  else if (frequency === "yearly") date.setFullYear(date.getFullYear() + 1);
  else date.setMonth(date.getMonth() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Firestore data access for SplitSync, ported from the Android
 * `SplitSyncRepository`. A repository instance is bound to the signed-in user's
 * uid; all per-user (ad-hoc) reads/writes are scoped to `/users/{uid}/...`.
 *
 * Read methods return an `Unsubscribe` so React hooks can detach listeners on
 * unmount (the web equivalent of the Kotlin `callbackFlow` + `awaitClose`).
 */
export function makeRepository(uid: string) {
  const db = getFirestoreDb();
  // --- Path helpers ---
  const groupsRef = () => collection(db, "groups");
  const groupDoc = (groupId: string) => doc(db, "groups", groupId);
  const membersRef = (groupId: string) =>
    collection(db, "groups", groupId, "members");
  const expensesRef = (groupId: string) =>
    collection(db, "groups", groupId, "expenses");
  const paymentsRef = (groupId: string) =>
    collection(db, "groups", groupId, "payments");
  const settlementRequestsRef = (groupId: string) =>
    collection(db, "groups", groupId, "settlementRequests");
  const recurringExpensesRef = (groupId: string) =>
    collection(db, "groups", groupId, "recurringExpenses");
  const expenseCommentsRef = (groupId: string) =>
    collection(db, "groups", groupId, "expenseComments");

  const friendsRef = () => collection(db, "users", uid, "friends");
  const adhocExpensesRef = () => collection(db, "users", uid, "adhocExpenses");
  const adhocPaymentsRef = () => collection(db, "users", uid, "adhocPayments");
  const groupInvitesRef = (u: string = uid) =>
    collection(db, "users", u, "groupInvites");
  const notificationsRef = () => collection(db, "users", uid, "notifications");
  const notificationDoc = (notificationId: string) =>
    doc(db, "users", uid, "notifications", notificationId);
  const notificationPreferencesDoc = () =>
    doc(db, "users", uid, "notificationPreferences", "default");
  const fcmTokensRef = () => collection(db, "users", uid, "fcmTokens");
  const fcmTokenDoc = (tokenHash: string) =>
    doc(db, "users", uid, "fcmTokens", tokenHash);

  async function commitBatched(
    actions: ((batch: ReturnType<typeof writeBatch>) => void)[]
  ): Promise<void> {
    for (let i = 0; i < actions.length; i += 450) {
      const batch = writeBatch(db);
      for (const action of actions.slice(i, i + 450)) {
        action(batch);
      }
      await batch.commit();
    }
  }

  // ----------------------------------------------------------------------
  // Group reads (multi-user shared, scoped via memberUids array-contains)
  // ----------------------------------------------------------------------
  function subscribeGroups(
    cb: Cb<Group[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    // Only filter server-side; sorting by createdAt is done client-side so the
    // query needs just the automatic single-field array-contains index (an
    // `array-contains` + `orderBy` combo would require a deployed composite
    // index, which silently breaks the dashboard list when absent).
    const q = query(groupsRef(), where("memberUids", "array-contains", uid));
    return onSnapshot(
      q,
      (snap) => {
        const groups = snap.docs
          .map(toGroup)
          .sort((a, b) => b.createdAt - a.createdAt);
        cb(groups);
      },
      snapshotError("groups", onError)
    );
  }

  function subscribeGroup(
    groupId: string,
    cb: Cb<Group | null>,
    onError?: ErrorCb
  ): Unsubscribe {
    return onSnapshot(
      groupDoc(groupId),
      (snap) => cb(snap.exists() ? toGroup(snap) : null),
      snapshotError(`group/${groupId}`, onError)
    );
  }

  function subscribeMembers(
    groupId: string,
    cb: Cb<GroupMember[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    return onSnapshot(
      membersRef(groupId),
      (snap) => cb(snap.docs.map(toMember)),
      snapshotError(`members/${groupId}`, onError)
    );
  }

  function subscribeExpenses(
    groupId: string,
    cb: Cb<Expense[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(expensesRef(groupId), orderBy("timestamp", "desc"));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toExpense)),
      snapshotError(`expenses/${groupId}`, onError)
    );
  }

  function subscribePayments(
    groupId: string,
    cb: Cb<Payment[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(paymentsRef(groupId), orderBy("timestamp", "desc"));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toPayment)),
      snapshotError(`payments/${groupId}`, onError)
    );
  }

  function subscribeSettlementRequests(
    groupId: string,
    cb: Cb<SettlementRequest[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(settlementRequestsRef(groupId), orderBy("updatedAt", "desc"));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toSettlementRequest)),
      snapshotError(`settlementRequests/${groupId}`, onError)
    );
  }

  function subscribeRecurringExpenses(
    groupId: string,
    cb: Cb<RecurringExpense[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(recurringExpensesRef(groupId), orderBy("nextDueAt", "asc"));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toRecurringExpense)),
      snapshotError(`recurringExpenses/${groupId}`, onError)
    );
  }

  function subscribeExpenseComments(
    groupId: string,
    cb: Cb<ExpenseComment[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(expenseCommentsRef(groupId), orderBy("createdAt", "asc"));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toExpenseComment)),
      snapshotError(`expenseComments/${groupId}`, onError)
    );
  }

  // ----------------------------------------------------------------------
  // Group writes
  // ----------------------------------------------------------------------
  async function createGroupWithMembers(
    groupName: string,
    description: string,
    members: NewGroupMember[],
    creator: { name: string; email: string },
    options: {
      template?: GroupTemplate;
      defaultCurrency?: string;
      settlementCurrency?: string;
      travelMode?: boolean;
    } = {}
  ): Promise<string> {
    const groupRef = doc(groupsRef());
    const groupId = groupRef.id;

    // Drop blanks and de-dupe linked members by uid so a friend can't be added
    // twice. Members without a linkedUid but with an email are resolved against
    // the users collection (covers friends added before linking existed), so
    // every registered participant ends up in memberUids.
    const cleaned: NewGroupMember[] = [];
    const seenUids = new Set<string>([uid]);
    for (const m of members) {
      const name = m.name.trim();
      if (!name) continue;
      let linkedUid = m.linkedUid.trim();
      const email = m.email.trim();
      if (!linkedUid && email) {
        const matches = await searchUsersByEmail(email);
        linkedUid = matches[0]?.uid ?? "";
      }
      if (linkedUid) {
        if (seenUids.has(linkedUid)) continue;
        seenUids.add(linkedUid);
      }
      cleaned.push({ name, email, linkedUid });
    }

    // Every linked member's uid joins the group so they can read it (the
    // `memberUids array-contains` query + security rules gate access on this).
    const memberUids = Array.from(seenUids);

    const batch = writeBatch(db);
    const group: Group = {
      id: groupId,
      name: groupName.trim(),
      description: description.trim(),
      createdAt: Date.now(),
      createdBy: uid,
      memberUids,
      status: "active",
      template: options.template ?? "custom",
      defaultCurrency: options.defaultCurrency ?? "USD",
      settlementCurrency:
        options.settlementCurrency ?? options.defaultCurrency ?? "USD",
      travelMode: options.travelMode === true,
    };
    batch.set(groupRef, group);

    // Creator's own member row. We store their real name (not the literal
    // "You") so other members see who they are; the UI relabels it as "You"
    // for whoever is currently signed in via the linkedUid match.
    const creatorRef = doc(membersRef(groupId));
    batch.set(creatorRef, {
      id: creatorRef.id,
      groupId,
      name: creator.name.trim() || "Me",
      email: creator.email.trim(),
      linkedUid: uid,
    } satisfies GroupMember);

    for (const m of cleaned) {
      const memberRef = doc(membersRef(groupId));
      batch.set(memberRef, {
        id: memberRef.id,
        groupId,
        name: m.name,
        email: m.email,
        linkedUid: m.linkedUid,
      } satisfies GroupMember);
    }
    await batch.commit();
    return groupId;
  }

  async function updateGroupProfile(
    group: Group,
    patch: GroupProfilePatch
  ): Promise<void> {
    if (!group.id) return;
    await updateDoc(
      groupDoc(group.id),
      withoutUndefined({
        name: patch.name?.trim(),
        description: patch.description?.trim(),
        template: patch.template,
        defaultCurrency: patch.defaultCurrency,
        settlementCurrency: patch.settlementCurrency,
        travelMode: patch.travelMode,
      })
    );
  }

  async function updateMemberPaymentProfile(
    groupId: string,
    memberId: string,
    patch: MemberPaymentPatch
  ): Promise<void> {
    if (!groupId || !memberId) return;
    await updateDoc(
      doc(membersRef(groupId), memberId),
      withoutUndefined({
        preferredPaymentMethod: patch.preferredPaymentMethod,
        paymentHandle: patch.paymentHandle?.trim(),
        paymentLink: patch.paymentLink?.trim(),
      })
    );
  }

  async function setGroupArchived(group: Group, archived: boolean): Promise<void> {
    if (!group.id) return;
    await updateDoc(
      groupDoc(group.id),
      archived
        ? {
            status: "archived",
            archivedAt: Date.now(),
            archivedByUid: uid,
          }
        : {
            status: "active",
            archivedAt: 0,
            archivedByUid: "",
          }
    );
  }

  async function createExpenseWithSplits(params: {
    groupId: string;
    description: string;
    amount: number;
    paidById: string;
    splitType: SplitType;
    splits: SplitPair[];
    timestamp?: number;
    currency?: string;
    category?: ExpenseCategorySlug;
  } & ExpenseWriteMetadata): Promise<string> {
    const ref = doc(expensesRef(params.groupId));
    const now = Date.now();
    const expense: Expense = {
      id: ref.id,
      groupId: params.groupId,
      description: params.description.trim(),
      amount: params.amount,
      paidById: params.paidById,
      splitType: params.splitType,
      timestamp: params.timestamp ?? Date.now(),
      currency: params.currency ?? "USD",
      splits: splitsToMap(params.splits),
      createdByUid: uid,
      category: params.category,
      notes: params.notes?.trim(),
      sourceType: params.sourceType,
      importBatchId: params.importBatchId,
      transactionFingerprint: params.transactionFingerprint,
      parserMode: params.parserMode,
      parserConfidence: params.parserConfidence,
      sourceConfidence: params.sourceConfidence,
      sourceWarnings: params.sourceWarnings,
      createdAt: now,
      updatedAt: now,
      editCount: 0,
      originalAmount: params.originalAmount,
      originalCurrency: params.originalCurrency,
      exchangeRate: params.exchangeRate,
      fxNote: params.fxNote?.trim(),
    };
    await setDoc(ref, withoutUndefined(expense));
    return ref.id;
  }

  async function createExpensesWithSplits(
    expenses: Array<{
      groupId: string;
      description: string;
      amount: number;
      paidById: string;
      splitType: SplitType;
      splits: SplitPair[];
      timestamp?: number;
      currency?: string;
      category?: ExpenseCategorySlug;
    } & ExpenseWriteMetadata>
  ): Promise<string[]> {
    const ids: string[] = [];
    const actions = expenses.map((params) => {
      const ref = doc(expensesRef(params.groupId));
      ids.push(ref.id);
      const now = Date.now();
      const expense: Expense = {
        id: ref.id,
        groupId: params.groupId,
        description: params.description.trim(),
        amount: params.amount,
        paidById: params.paidById,
        splitType: params.splitType,
        timestamp: params.timestamp ?? Date.now(),
        currency: params.currency ?? "USD",
        splits: splitsToMap(params.splits),
        createdByUid: uid,
        category: params.category,
        sourceType: params.sourceType,
        importBatchId: params.importBatchId,
        transactionFingerprint: params.transactionFingerprint,
        parserMode: params.parserMode,
        parserConfidence: params.parserConfidence,
        notes: params.notes?.trim(),
        sourceConfidence: params.sourceConfidence,
        sourceWarnings: params.sourceWarnings,
        createdAt: now,
        updatedAt: now,
        editCount: 0,
        originalAmount: params.originalAmount,
        originalCurrency: params.originalCurrency,
        exchangeRate: params.exchangeRate,
        fxNote: params.fxNote?.trim(),
      };
      return (batch: ReturnType<typeof writeBatch>) =>
        batch.set(ref, withoutUndefined(expense));
    });
    await commitBatched(actions);
    return ids;
  }

  async function deleteExpense(expense: Expense): Promise<void> {
    if (!expense.id || !expense.groupId) return;
    await deleteDoc(doc(expensesRef(expense.groupId), expense.id));
  }

  async function updateExpense(
    groupId: string,
    expenseId: string,
    patch: ExpenseUpdatePatch
  ): Promise<void> {
    if (!groupId || !expenseId) return;
    const next: Record<string, unknown> = {
      ...patch,
      notes: patch.notes?.trim(),
      splits: patch.splits ? splitsToMap(patch.splits) : undefined,
      updatedAt: Date.now(),
      lastEditedByUid: uid,
      editCount: increment(1),
    };
    await updateDoc(doc(expensesRef(groupId), expenseId), withoutUndefined(next));
  }

  async function updateExpenseDispute(
    groupId: string,
    expenseId: string,
    patch: {
      disputeStatus: ExpenseDisputeStatus;
      disputeNote?: string;
    }
  ): Promise<void> {
    if (!groupId || !expenseId) return;
    await updateDoc(
      doc(expensesRef(groupId), expenseId),
      withoutUndefined({
        disputeStatus: patch.disputeStatus,
        disputeNote: patch.disputeNote?.trim(),
        disputedByUid:
          patch.disputeStatus === "needs_clarification" ? uid : undefined,
        disputedAt:
          patch.disputeStatus === "needs_clarification" ? Date.now() : undefined,
        updatedAt: Date.now(),
        lastEditedByUid: uid,
        editCount: increment(1),
      })
    );
  }

  async function addExpenseComment(params: {
    groupId: string;
    expenseId: string;
    body: string;
    createdByName: string;
  }): Promise<string> {
    const ref = doc(expenseCommentsRef(params.groupId));
    const comment: ExpenseComment = {
      id: ref.id,
      groupId: params.groupId,
      expenseId: params.expenseId,
      body: params.body.trim(),
      createdAt: Date.now(),
      createdByUid: uid,
      createdByName: params.createdByName.trim() || "Someone",
    };
    await setDoc(ref, comment);
    return ref.id;
  }

  async function createRecurringExpense(
    params: RecurringExpenseWrite
  ): Promise<string> {
    const ref = doc(recurringExpensesRef(params.groupId));
    const now = Date.now();
    const recurring: RecurringExpense = {
      id: ref.id,
      groupId: params.groupId,
      description: params.description.trim(),
      amount: params.amount,
      paidById: params.paidById,
      splitType: params.splitType,
      currency: params.currency ?? "USD",
      splits: splitsToMap(params.splits),
      category: params.category,
      frequency: params.frequency,
      nextDueAt: params.nextDueAt,
      active: params.active !== false,
      notes: params.notes?.trim(),
      createdAt: now,
      updatedAt: now,
      createdByUid: uid,
      originalAmount: params.originalAmount,
      originalCurrency: params.originalCurrency,
      exchangeRate: params.exchangeRate,
      fxNote: params.fxNote?.trim(),
    };
    await setDoc(ref, withoutUndefined(recurring));
    return ref.id;
  }

  async function updateRecurringExpense(
    groupId: string,
    recurringId: string,
    patch: Partial<RecurringExpenseWrite> & {
      splits?: SplitPair[];
      lastPostedAt?: number;
    }
  ): Promise<void> {
    if (!groupId || !recurringId) return;
    await updateDoc(
      doc(recurringExpensesRef(groupId), recurringId),
      withoutUndefined({
        ...patch,
        description: patch.description?.trim(),
        notes: patch.notes?.trim(),
        fxNote: patch.fxNote?.trim(),
        splits: patch.splits ? splitsToMap(patch.splits) : undefined,
        updatedAt: Date.now(),
      })
    );
  }

  async function deleteRecurringExpense(
    groupId: string,
    recurringId: string
  ): Promise<void> {
    if (!groupId || !recurringId) return;
    await deleteDoc(doc(recurringExpensesRef(groupId), recurringId));
  }

  async function postRecurringExpense(
    recurring: RecurringExpense
  ): Promise<string> {
    const expenseId = await createExpenseWithSplits({
      groupId: recurring.groupId,
      description: recurring.description,
      amount: recurring.amount,
      paidById: recurring.paidById,
      splitType: recurring.splitType,
      splits: Object.entries(recurring.splits),
      timestamp: recurring.nextDueAt,
      currency: recurring.currency,
      category: recurring.category,
      notes: recurring.notes,
      sourceType: "manual",
      originalAmount: recurring.originalAmount,
      originalCurrency: recurring.originalCurrency,
      exchangeRate: recurring.exchangeRate,
      fxNote: recurring.fxNote,
    });
    await updateRecurringExpense(recurring.groupId, recurring.id, {
      nextDueAt: nextRecurringDueAt(recurring.nextDueAt, recurring.frequency),
      lastPostedAt: Date.now(),
    });
    return expenseId;
  }

  async function recordPayment(
    payment: Omit<Payment, "id">
  ): Promise<void> {
    const ref = doc(paymentsRef(payment.groupId));
    await setDoc(ref, { ...payment, id: ref.id, createdByUid: uid });
  }

  async function updatePayment(
    groupId: string,
    paymentId: string,
    patch: PaymentUpdatePatch
  ): Promise<void> {
    if (!groupId || !paymentId) return;
    await updateDoc(
      doc(paymentsRef(groupId), paymentId),
      withoutUndefined({
        ...patch,
        updatedAt: Date.now(),
        lastEditedByUid: uid,
        editCount: increment(1),
      })
    );
  }

  async function deletePayment(payment: Payment): Promise<void> {
    if (!payment.id || !payment.groupId) return;
    await deleteDoc(doc(paymentsRef(payment.groupId), payment.id));
  }

  async function createSettlementRequest(params: {
    groupId: string;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    currency: string;
    message: string;
    remindAfter?: number;
  }): Promise<string> {
    const ref = doc(settlementRequestsRef(params.groupId));
    const now = Date.now();
    const request: SettlementRequest = {
      id: ref.id,
      groupId: params.groupId,
      fromMemberId: params.fromMemberId,
      toMemberId: params.toMemberId,
      amount: params.amount,
      currency: params.currency,
      message: params.message.trim(),
      status: "requested",
      createdAt: now,
      updatedAt: now,
      requestedByUid: uid,
      remindAfter: params.remindAfter,
    };
    await setDoc(ref, withoutUndefined(request));
    return ref.id;
  }

  async function updateSettlementRequest(
    groupId: string,
    requestId: string,
    patch: SettlementRequestPatch
  ): Promise<void> {
    if (!groupId || !requestId) return;
    await updateDoc(
      doc(settlementRequestsRef(groupId), requestId),
      withoutUndefined({
        ...patch,
        message: patch.message?.trim(),
        updatedAt: Date.now(),
      })
    );
  }

  async function deleteSettlementRequest(
    groupId: string,
    requestId: string
  ): Promise<void> {
    if (!groupId || !requestId) return;
    await deleteDoc(doc(settlementRequestsRef(groupId), requestId));
  }

  /** Deletes a group and every subcollection doc (Firestore has no cascade). */
  async function deleteGroup(group: Group): Promise<void> {
    if (!group.id) return;
    const gid = group.id;
    const [membersSnap, expensesSnap, paymentsSnap] = await Promise.all([
      getDocs(membersRef(gid)),
      getDocs(expensesRef(gid)),
      getDocs(paymentsRef(gid)),
    ]);

    const childDocs = [
      ...membersSnap.docs,
      ...expensesSnap.docs,
      ...paymentsSnap.docs,
    ];

    for (let i = 0; i < childDocs.length; i += 450) {
      const batch = writeBatch(db);
      for (const d of childDocs.slice(i, i + 450)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }

    await deleteDoc(groupDoc(gid));
  }

  // ----------------------------------------------------------------------
  // User search (for adding friends)
  // ----------------------------------------------------------------------
  async function searchUsersByEmail(
    email: string
  ): Promise<{ uid: string; displayName: string; email: string; photoUrl: string }[]> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return [];
    const snap = await getDocs(
      query(collection(db, "users"), where("email", "==", normalized), limit(5))
    );
    return snap.docs
      .filter((d) => d.id !== uid)
      .map((d) => {
        const data = d.data();
        return {
          uid: d.id,
          displayName: (data.displayName as string) ?? "",
          email: (data.email as string) ?? "",
          photoUrl: (data.photoUrl as string) ?? "",
        };
      });
  }

  // ----------------------------------------------------------------------
  // Ad-hoc peer-to-peer ledger (scoped to /users/{uid}/...)
  // ----------------------------------------------------------------------
  function subscribeFriends(cb: Cb<Friend[]>): Unsubscribe {
    const q = query(friendsRef(), orderBy("name"));
    return onSnapshot(q, (snap) => cb(snap.docs.map(toFriend)), snapshotError("friends"));
  }

  function subscribeAdHocExpenses(cb: Cb<AdHocExpense[]>): Unsubscribe {
    const q = query(adhocExpensesRef(), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => cb(snap.docs.map(toAdHocExpense)), snapshotError("adhocExpenses"));
  }

  function subscribeAdHocPayments(cb: Cb<AdHocPayment[]>): Unsubscribe {
    const q = query(adhocPaymentsRef(), orderBy("timestamp", "desc"));
    return onSnapshot(q, (snap) => cb(snap.docs.map(toAdHocPayment)), snapshotError("adhocPayments"));
  }

  async function migrateLocalFriendAliases(): Promise<void> {
    const [friendsSnap, expensesSnap, paymentsSnap] = await Promise.all([
      getDocs(friendsRef()),
      getDocs(adhocExpensesRef()),
      getDocs(adhocPaymentsRef()),
    ]);

    const identityIndex = buildFriendIdentityIndex(friendsSnap.docs.map(toFriend));
    const hasAliases = Array.from(identityIndex.aliasesByCanonicalId.values()).some(
      (aliases) => aliases.length > 1
    );
    if (!hasAliases) return;

    const expenses = expensesSnap.docs.map(toAdHocExpense);
    const payments = paymentsSnap.docs.map(toAdHocPayment);
    const canonicalExpenses = canonicalizeAdHocExpenses(
      expenses,
      identityIndex.aliasToCanonicalId
    );
    const canonicalPayments = canonicalizeAdHocPayments(
      payments,
      identityIndex.aliasToCanonicalId
    );

    const actions: ((batch: ReturnType<typeof writeBatch>) => void)[] = [];

    expenses.forEach((expense, index) => {
      if (expense.mirroredFromPath) return;
      const canonical = canonicalExpenses[index];
      if (
        expense.paidByFriendId !== canonical.paidByFriendId ||
        !numberMapsEqual(expense.splits, canonical.splits)
      ) {
        actions.push((batch) =>
          batch.update(expensesSnap.docs[index].ref, {
            paidByFriendId: canonical.paidByFriendId,
            splits: canonical.splits,
          })
        );
      }
    });

    payments.forEach((payment, index) => {
      if (payment.mirroredFromPath) return;
      const canonical = canonicalPayments[index];
      if (
        payment.fromFriendId !== canonical.fromFriendId ||
        payment.toFriendId !== canonical.toFriendId
      ) {
        actions.push((batch) =>
          batch.update(paymentsSnap.docs[index].ref, {
            fromFriendId: canonical.fromFriendId,
            toFriendId: canonical.toFriendId,
          })
        );
      }
    });

    // Keep alias friend docs on the client. Firestore rules intentionally block
    // clients from updating mirrored ledger docs, so deleting aliases here could
    // make server-created history impossible to remap until the admin function
    // runs. The read model still collapses these aliases immediately.
    await commitBatched(actions);
  }

  async function createFriend(
    name: string,
    email: string,
    phone: string,
    linkedUid: string = ""
  ): Promise<string> {
    const ref = doc(friendsRef());
    const friend: Friend = {
      id: ref.id,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      createdAt: Date.now(),
      linkedUid,
      createdByUid: uid,
    };
    await setDoc(ref, friend);
    return ref.id;
  }

  /**
   * Adds a registered SplitSync user as a friend, creating the link on BOTH
   * sides so the friendship is mutual. Each side's friend doc is keyed by the
   * *other* user's uid, which makes the write idempotent (re-adding can't
   * create duplicates) and lets either party tear the link down later.
   */
  async function addRegisteredFriend(
    target: { uid: string; name: string; email: string },
    me: { name: string; email: string }
  ): Promise<void> {
    if (!target.uid || target.uid === uid) return;
    const now = Date.now();

    const mine: Friend = {
      id: target.uid,
      name: target.name.trim(),
      email: target.email.trim(),
      phone: "",
      createdAt: now,
      linkedUid: target.uid,
      createdByUid: uid,
    };
    const theirs: Friend = {
      id: uid,
      name: me.name.trim() || "SplitSync user",
      email: me.email.trim(),
      phone: "",
      createdAt: now,
      linkedUid: uid,
      createdByUid: uid,
    };

    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid, "friends", target.uid), mine);
    batch.set(doc(db, "users", target.uid, "friends", uid), theirs);
    await batch.commit();
    await migrateLocalFriendAliases();
  }

  async function deleteFriend(friend: Friend): Promise<void> {
    if (!friend.id) return;
    const [friendsSnap, expensesSnap, paymentsSnap] = await Promise.all([
      getDocs(friendsRef()),
      getDocs(adhocExpensesRef()),
      getDocs(adhocPaymentsRef()),
    ]);

    const identityIndex = buildFriendIdentityIndex(friendsSnap.docs.map(toFriend));
    const canonicalId = identityIndex.aliasToCanonicalId.get(friend.id) ?? friend.id;
    const canonicalFriend = identityIndex.canonicalById.get(canonicalId) ?? friend;
    const canonicalExpenses = canonicalizeAdHocExpenses(
      expensesSnap.docs.map(toAdHocExpense),
      identityIndex.aliasToCanonicalId
    );
    const canonicalPayments = canonicalizeAdHocPayments(
      paymentsSnap.docs.map(toAdHocPayment),
      identityIndex.aliasToCanonicalId
    );
    const balances = calculateFriendBalances(
      [canonicalFriend],
      canonicalExpenses,
      canonicalPayments
    );
    if (balances.some((b) => Math.abs(b.netBalance) > 0.01)) {
      throw new Error("Settle this friend before deleting them.");
    }

    const aliases = identityIndex.aliasesByCanonicalId.get(canonicalId) ?? [
      friend.id,
    ];
    await commitBatched(
      aliases.map((aliasId) => (batch) =>
        batch.delete(doc(friendsRef(), aliasId))
      )
    );
  }

  async function createAdHocExpenseWithSplits(params: {
    description: string;
    amount: number;
    paidByFriendId: string;
    splitType: SplitType;
    splits: SplitPair[];
    currency?: string;
    timestamp?: number;
    category?: ExpenseCategorySlug;
  } & ExpenseWriteMetadata): Promise<string> {
    const ref = doc(adhocExpensesRef());
    const now = Date.now();
    const expense: AdHocExpense = {
      id: ref.id,
      description: params.description.trim(),
      amount: params.amount,
      paidByFriendId: params.paidByFriendId,
      splitType: params.splitType,
      timestamp: params.timestamp ?? Date.now(),
      currency: params.currency ?? "USD",
      splits: splitsToMap(params.splits),
      createdByUid: uid,
      category: params.category,
      sourceType: params.sourceType,
      importBatchId: params.importBatchId,
      transactionFingerprint: params.transactionFingerprint,
      parserMode: params.parserMode,
      parserConfidence: params.parserConfidence,
      notes: params.notes?.trim(),
      sourceConfidence: params.sourceConfidence,
      sourceWarnings: params.sourceWarnings,
      createdAt: now,
      updatedAt: now,
      editCount: 0,
    };
    await setDoc(ref, withoutUndefined(expense));
    return ref.id;
  }

  async function createAdHocExpensesWithSplits(
    expenses: Array<{
      description: string;
      amount: number;
      paidByFriendId: string;
      splitType: SplitType;
      splits: SplitPair[];
      currency?: string;
      timestamp?: number;
      category?: ExpenseCategorySlug;
    } & ExpenseWriteMetadata>
  ): Promise<string[]> {
    const ids: string[] = [];
    const actions = expenses.map((params) => {
      const ref = doc(adhocExpensesRef());
      ids.push(ref.id);
      const now = Date.now();
      const expense: AdHocExpense = {
        id: ref.id,
        description: params.description.trim(),
        amount: params.amount,
        paidByFriendId: params.paidByFriendId,
        splitType: params.splitType,
        timestamp: params.timestamp ?? Date.now(),
        currency: params.currency ?? "USD",
        splits: splitsToMap(params.splits),
        createdByUid: uid,
        category: params.category,
        sourceType: params.sourceType,
        importBatchId: params.importBatchId,
        transactionFingerprint: params.transactionFingerprint,
        parserMode: params.parserMode,
        parserConfidence: params.parserConfidence,
        notes: params.notes?.trim(),
        sourceConfidence: params.sourceConfidence,
        sourceWarnings: params.sourceWarnings,
        createdAt: now,
        updatedAt: now,
        editCount: 0,
      };
      return (batch: ReturnType<typeof writeBatch>) =>
        batch.set(ref, withoutUndefined(expense));
    });
    await commitBatched(actions);
    return ids;
  }

  async function deleteAdHocExpense(expense: AdHocExpense): Promise<void> {
    if (!expense.id) return;
    await deleteDoc(doc(adhocExpensesRef(), expense.id));
  }

  async function updateAdHocExpense(
    expenseId: string,
    patch: AdHocExpenseUpdatePatch
  ): Promise<void> {
    if (!expenseId) return;
    const next: Record<string, unknown> = {
      ...patch,
      notes: patch.notes?.trim(),
      splits: patch.splits ? splitsToMap(patch.splits) : undefined,
      updatedAt: Date.now(),
      lastEditedByUid: uid,
      editCount: increment(1),
    };
    await updateDoc(doc(adhocExpensesRef(), expenseId), withoutUndefined(next));
  }

  async function recordAdHocPayment(
    payment: Omit<AdHocPayment, "id">
  ): Promise<void> {
    const ref = doc(adhocPaymentsRef());
    await setDoc(ref, { ...payment, id: ref.id, createdByUid: uid });
  }

  async function deleteAdHocPayment(payment: AdHocPayment): Promise<void> {
    if (!payment.id) return;
    await deleteDoc(doc(adhocPaymentsRef(), payment.id));
  }

  // ----------------------------------------------------------------------
  // Group invitations
  // ----------------------------------------------------------------------
  function subscribeInvites(cb: Cb<GroupInvite[]>): Unsubscribe {
    const q = query(groupInvitesRef(), orderBy("invitedAt", "desc"));
    return onSnapshot(q, (snap) => cb(snap.docs.map(toInvite)), snapshotError("invites"));
  }

  /**
   * Looks up a user by email and writes a
   * `/users/{inviteeUid}/groupInvites/{groupId}` doc. Returns true if an invite
   * was written (or the target is already a member), false if no user with that
   * email exists yet.
   */
  async function inviteToGroupByEmail(
    group: Group,
    email: string,
    invitedByName: string
  ): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;

    const snap = await getDocs(
      query(collection(db, "users"), where("email", "==", normalized), limit(1))
    );
    const target = snap.docs[0];
    if (!target) return false;
    const targetUid = target.id;
    if (group.memberUids.includes(targetUid)) return true;

    const invite: GroupInvite = {
      id: group.id,
      groupId: group.id,
      groupName: group.name,
      invitedByUid: uid,
      invitedByName,
      invitedAt: Date.now(),
    };
    await setDoc(doc(groupInvitesRef(targetUid), group.id), invite);
    return true;
  }

  /**
   * Accepts an invite: appends uid to the group's memberUids, inserts a linked
   * GroupMember, and removes the invite — all atomically.
   */
  async function acceptInvite(
    invite: GroupInvite,
    myDisplayName: string,
    myEmail: string
  ): Promise<void> {
    if (!invite.groupId) return;
    const gref = groupDoc(invite.groupId);
    const mref = doc(membersRef(invite.groupId));
    const member: GroupMember = {
      id: mref.id,
      groupId: invite.groupId,
      name: myDisplayName || "Me",
      email: myEmail,
      linkedUid: uid,
    };

    const batch = writeBatch(db);
    batch.update(gref, { memberUids: arrayUnion(uid) });
    batch.set(mref, member);
    batch.delete(doc(groupInvitesRef(), invite.id));
    await batch.commit();
  }

  async function declineInvite(invite: GroupInvite): Promise<void> {
    if (!invite.id) return;
    await deleteDoc(doc(groupInvitesRef(), invite.id));
  }

  // ----------------------------------------------------------------------
  // Notifications + browser push registration
  // ----------------------------------------------------------------------
  function subscribeNotifications(
    cb: Cb<Notification[]>,
    onError?: ErrorCb
  ): Unsubscribe {
    const q = query(notificationsRef(), orderBy("createdAt", "desc"), limit(50));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map(toNotification)),
      snapshotError("notifications", onError)
    );
  }

  function subscribeNotificationPreferences(
    cb: Cb<NotificationPreference | null>,
    onError?: ErrorCb
  ): Unsubscribe {
    return onSnapshot(
      notificationPreferencesDoc(),
      (snap) => cb(snap.exists() ? toNotificationPreference(snap) : null),
      snapshotError("notificationPreferences", onError)
    );
  }

  async function markNotificationRead(notificationId: string): Promise<void> {
    if (!notificationId) return;
    await updateDoc(notificationDoc(notificationId), { readAt: Date.now() });
  }

  async function markAllNotificationsRead(): Promise<void> {
    const snap = await getDocs(query(notificationsRef(), where("readAt", "==", null)));
    const batch = writeBatch(db);
    const now = Date.now();
    for (const d of snap.docs) {
      batch.update(d.ref, { readAt: now });
    }
    await batch.commit();
  }

  async function updateNotificationPreferences(
    patch: Partial<NotificationPreference>
  ): Promise<void> {
    const ref = notificationPreferencesDoc();
    const existing = await getDoc(ref);
    const current = existing.exists()
      ? toNotificationPreference(existing)
      : {
          pushEnabled: false,
          eventChannels: {},
          largeExpenseThresholds: {},
          updatedAt: 0,
        };
    await setDoc(
      ref,
      {
        ...current,
        ...patch,
        updatedAt: Date.now(),
      },
      { merge: false }
    );
  }

  async function saveFcmToken(params: {
    tokenHash: string;
    token: string;
    deviceLabel: string;
    userAgent: string;
  }): Promise<void> {
    const now = Date.now();
    const ref = fcmTokenDoc(params.tokenHash);
    await setDoc(
      ref,
      {
        token: params.token,
        deviceLabel: params.deviceLabel,
        userAgent: params.userAgent,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      } satisfies Omit<FcmToken, "id">,
      { merge: true }
    );
  }

  async function deleteFcmToken(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await deleteDoc(fcmTokenDoc(tokenHash));
  }

  return {
    uid,
    subscribeGroups,
    subscribeGroup,
    subscribeMembers,
    subscribeExpenses,
    subscribePayments,
    subscribeSettlementRequests,
    subscribeRecurringExpenses,
    subscribeExpenseComments,
    createGroupWithMembers,
    updateGroupProfile,
    updateMemberPaymentProfile,
    setGroupArchived,
    createExpenseWithSplits,
    createExpensesWithSplits,
    deleteExpense,
    updateExpense,
    updateExpenseDispute,
    addExpenseComment,
    createRecurringExpense,
    updateRecurringExpense,
    deleteRecurringExpense,
    postRecurringExpense,
    recordPayment,
    updatePayment,
    deletePayment,
    createSettlementRequest,
    updateSettlementRequest,
    deleteSettlementRequest,
    deleteGroup,
    searchUsersByEmail,
    subscribeFriends,
    subscribeAdHocExpenses,
    subscribeAdHocPayments,
    createFriend,
    addRegisteredFriend,
    deleteFriend,
    createAdHocExpenseWithSplits,
    createAdHocExpensesWithSplits,
    deleteAdHocExpense,
    updateAdHocExpense,
    recordAdHocPayment,
    deleteAdHocPayment,
    subscribeInvites,
    inviteToGroupByEmail,
    acceptInvite,
    declineInvite,
    subscribeNotifications,
    subscribeNotificationPreferences,
    markNotificationRead,
    markAllNotificationsRead,
    updateNotificationPreferences,
    saveFcmToken,
    deleteFcmToken,
  };
}

export type Repository = ReturnType<typeof makeRepository>;
