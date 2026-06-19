import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { calculateFriendBalances } from "@/lib/balances";
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
import type { SplitPair } from "@/lib/splits";
import { splitsToMap } from "@/lib/splits";
import {
  toAdHocExpense,
  toAdHocPayment,
  toExpense,
  toFriend,
  toGroup,
  toInvite,
  toMember,
  toPayment,
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

function snapshotError(label: string, onError?: ErrorCb) {
  return (err: Error) => {
    console.warn(`[SplitSync] ${label} listener failed:`, err.message);
    onError?.(err);
  };
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
  // --- Path helpers ---
  const groupsRef = () => collection(db, "groups");
  const groupDoc = (groupId: string) => doc(db, "groups", groupId);
  const membersRef = (groupId: string) =>
    collection(db, "groups", groupId, "members");
  const expensesRef = (groupId: string) =>
    collection(db, "groups", groupId, "expenses");
  const paymentsRef = (groupId: string) =>
    collection(db, "groups", groupId, "payments");

  const friendsRef = () => collection(db, "users", uid, "friends");
  const adhocExpensesRef = () => collection(db, "users", uid, "adhocExpenses");
  const adhocPaymentsRef = () => collection(db, "users", uid, "adhocPayments");
  const groupInvitesRef = (u: string = uid) =>
    collection(db, "users", u, "groupInvites");

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

  // ----------------------------------------------------------------------
  // Group writes
  // ----------------------------------------------------------------------
  async function createGroupWithMembers(
    groupName: string,
    description: string,
    members: NewGroupMember[],
    creator: { name: string; email: string }
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

  async function createExpenseWithSplits(params: {
    groupId: string;
    description: string;
    amount: number;
    paidById: string;
    splitType: SplitType;
    splits: SplitPair[];
    timestamp?: number;
    currency?: string;
  }): Promise<void> {
    const ref = doc(expensesRef(params.groupId));
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
    };
    await setDoc(ref, expense);
  }

  async function deleteExpense(expense: Expense): Promise<void> {
    if (!expense.id || !expense.groupId) return;
    await deleteDoc(doc(expensesRef(expense.groupId), expense.id));
  }

  async function recordPayment(
    payment: Omit<Payment, "id">
  ): Promise<void> {
    const ref = doc(paymentsRef(payment.groupId));
    await setDoc(ref, { ...payment, id: ref.id });
  }

  async function deletePayment(payment: Payment): Promise<void> {
    if (!payment.id || !payment.groupId) return;
    await deleteDoc(doc(paymentsRef(payment.groupId), payment.id));
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
    };
    const theirs: Friend = {
      id: uid,
      name: me.name.trim() || "SplitSync user",
      email: me.email.trim(),
      phone: "",
      createdAt: now,
      linkedUid: uid,
    };

    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid, "friends", target.uid), mine);
    batch.set(doc(db, "users", target.uid, "friends", uid), theirs);
    await batch.commit();
  }

  async function deleteFriend(friend: Friend): Promise<void> {
    if (!friend.id) return;
    const [expensesSnap, paymentsSnap] = await Promise.all([
      getDocs(adhocExpensesRef()),
      getDocs(adhocPaymentsRef()),
    ]);
    const balances = calculateFriendBalances(
      [friend],
      expensesSnap.docs.map(toAdHocExpense),
      paymentsSnap.docs.map(toAdHocPayment)
    );
    if (balances.some((b) => Math.abs(b.netBalance) > 0.01)) {
      throw new Error("Settle this friend before deleting them.");
    }
    await deleteDoc(doc(friendsRef(), friend.id));
  }

  async function createAdHocExpenseWithSplits(params: {
    description: string;
    amount: number;
    paidByFriendId: string;
    splitType: SplitType;
    splits: SplitPair[];
    currency?: string;
    timestamp?: number;
  }): Promise<string> {
    const ref = doc(adhocExpensesRef());
    const expense: AdHocExpense = {
      id: ref.id,
      description: params.description.trim(),
      amount: params.amount,
      paidByFriendId: params.paidByFriendId,
      splitType: params.splitType,
      timestamp: params.timestamp ?? Date.now(),
      currency: params.currency ?? "USD",
      splits: splitsToMap(params.splits),
    };
    await setDoc(ref, expense);
    return ref.id;
  }

  async function deleteAdHocExpense(expense: AdHocExpense): Promise<void> {
    if (!expense.id) return;
    await deleteDoc(doc(adhocExpensesRef(), expense.id));
  }

  async function recordAdHocPayment(
    payment: Omit<AdHocPayment, "id">
  ): Promise<void> {
    const ref = doc(adhocPaymentsRef());
    await setDoc(ref, { ...payment, id: ref.id });
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

  return {
    uid,
    subscribeGroups,
    subscribeGroup,
    subscribeMembers,
    subscribeExpenses,
    subscribePayments,
    createGroupWithMembers,
    createExpenseWithSplits,
    deleteExpense,
    recordPayment,
    deletePayment,
    deleteGroup,
    searchUsersByEmail,
    subscribeFriends,
    subscribeAdHocExpenses,
    subscribeAdHocPayments,
    createFriend,
    addRegisteredFriend,
    deleteFriend,
    createAdHocExpenseWithSplits,
    deleteAdHocExpense,
    recordAdHocPayment,
    deleteAdHocPayment,
    subscribeInvites,
    inviteToGroupByEmail,
    acceptInvite,
    declineInvite,
  };
}

export type Repository = ReturnType<typeof makeRepository>;
