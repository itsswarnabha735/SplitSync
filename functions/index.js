"use strict";

const admin = require("firebase-admin");
const {
  onDocumentCreatedWithAuthContext,
  onDocumentDeletedWithAuthContext,
} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const {
  notificationDocId,
  formatMoney,
  shouldSendChannel,
  largeExpenseTags,
  actorName,
  buildGroupExpenseNotification,
} = require("./notification-core");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const SELF = "self";
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

function now() {
  return Date.now();
}

function dataOf(snapshot) {
  return snapshot?.data() || {};
}

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function strongUid(friend) {
  return (friend.linkedUid || friend.id || "").trim();
}

function hasStrongFriendIdentity(friend) {
  return Boolean((friend.linkedUid || "").trim() || normalizeEmail(friend.email));
}

function stronglyMatchesFriend(a, b) {
  const aUid = strongUid(a);
  const bUid = strongUid(b);
  if (aUid && bUid && aUid === bUid) return true;

  const aEmail = normalizeEmail(a.email);
  const bEmail = normalizeEmail(b.email);
  return Boolean(aEmail && bEmail && aEmail === bEmail);
}

function canonicalParticipantId(id, aliasToCanonicalId) {
  if (id === SELF) return SELF;
  return aliasToCanonicalId.get(id) || id;
}

function canonicalAmountMap(values, aliasToCanonicalId) {
  return Object.entries(values || {}).reduce((out, [id, amount]) => {
    const canonicalId = canonicalParticipantId(id, aliasToCanonicalId);
    out[canonicalId] = (out[canonicalId] || 0) + (amount || 0);
    return out;
  }, {});
}

function numberMapsEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => a[key] === b[key])
  );
}

async function commitAdminActions(actions) {
  for (let i = 0; i < actions.length; i += 450) {
    const batch = db.batch();
    actions.slice(i, i + 450).forEach((action) => action(batch));
    await batch.commit();
  }
}

function actorUid(event, data = {}) {
  return (
    event.authId ||
    event.auth?.uid ||
    data.createdByUid ||
    data.invitedByUid ||
    data.linkedUid ||
    ""
  );
}

async function userName(uid) {
  if (!uid) return "Someone";
  const snap = await db.doc(`users/${uid}`).get();
  const data = dataOf(snap);
  return data.displayName || data.email || "Someone";
}

async function groupContext(groupId) {
  const groupSnap = await db.doc(`groups/${groupId}`).get();
  if (!groupSnap.exists) return null;
  const membersSnap = await db.collection(`groups/${groupId}/members`).get();
  const group = { id: groupSnap.id, ...dataOf(groupSnap) };
  const members = membersSnap.docs.map((doc) => ({ id: doc.id, ...dataOf(doc) }));
  const memberById = new Map(members.map((member) => [member.id, member]));
  return { group, members, memberById };
}

function linkedMembers(ctx) {
  return ctx.members.filter((member) => member.linkedUid);
}

async function preferencesFor(uid) {
  const snap = await db.doc(`users/${uid}/notificationPreferences/default`).get();
  return snap.exists
    ? dataOf(snap)
    : { pushEnabled: false, eventChannels: {}, largeExpenseThresholds: {} };
}

async function sendPush(uid, notificationId, payload) {
  const tokenSnap = await db.collection(`users/${uid}/fcmTokens`).get();
  if (tokenSnap.empty) return;
  const docs = tokenSnap.docs.filter((doc) => dataOf(doc).token);
  if (docs.length === 0) return;

  for (let i = 0; i < docs.length; i += 500) {
    const batchDocs = docs.slice(i, i + 500);
    const tokens = batchDocs.map((doc) => dataOf(doc).token);
    try {
      const result = await messaging.sendEachForMulticast({
        tokens,
        data: {
          title: payload.title,
          body: payload.body,
          url: payload.targetUrl,
          notificationId,
          type: payload.type,
        },
        webpush: {
          headers: {
            Urgency: "normal",
          },
        },
      });
      const cleanup = db.batch();
      let cleanupCount = 0;
      result.responses.forEach((response, index) => {
        if (!response.success && INVALID_TOKEN_CODES.has(response.error?.code)) {
          cleanup.delete(batchDocs[index].ref);
          cleanupCount += 1;
        }
      });
      if (cleanupCount > 0) await cleanup.commit();
    } catch (err) {
      logger.warn("FCM push failed", { uid, error: err.message });
    }
  }
}

async function dispatchTo(uid, payload) {
  if (!uid) return;
  const prefs = await preferencesFor(uid);
  const id = notificationDocId(payload.eventId, uid);
  const notification = {
    type: payload.type,
    title: payload.title,
    body: payload.body,
    actorUid: payload.actorUid || "",
    targetUrl: payload.targetUrl || "/dashboard",
    createdAt: now(),
    readAt: null,
    eventId: payload.eventId,
    source: payload.source || { collection: "", id: "" },
  };

  if (shouldSendChannel(prefs, payload.type, "inApp")) {
    await db.doc(`users/${uid}/notifications/${id}`).set(notification);
  }
  if (shouldSendChannel(prefs, payload.type, "push")) {
    await sendPush(uid, id, notification);
  }
}

function source(collection, id, extra = {}) {
  return { collection, id, ...extra };
}

async function notifyGroupMembers(ctx, excludedUid, payloadFactory) {
  await Promise.all(
    linkedMembers(ctx)
      .filter((member) => member.linkedUid !== excludedUid)
      .map((member) => dispatchTo(member.linkedUid, payloadFactory(member)))
  );
}

async function isGroupSettled(groupId, currency) {
  const ctx = await groupContext(groupId);
  if (!ctx) return false;
  const balances = new Map(ctx.members.map((member) => [member.id, 0]));
  const [expensesSnap, paymentsSnap] = await Promise.all([
    db.collection(`groups/${groupId}/expenses`).get(),
    db.collection(`groups/${groupId}/payments`).get(),
  ]);

  let sawCurrency = false;
  expensesSnap.docs.forEach((doc) => {
    const expense = dataOf(doc);
    if (expense.currency !== currency) return;
    sawCurrency = true;
    balances.set(
      expense.paidById,
      (balances.get(expense.paidById) || 0) + (expense.amount || 0)
    );
    Object.entries(expense.splits || {}).forEach(([memberId, share]) => {
      balances.set(memberId, (balances.get(memberId) || 0) - (share || 0));
    });
  });
  paymentsSnap.docs.forEach((doc) => {
    const payment = dataOf(doc);
    if (payment.currency !== currency) return;
    sawCurrency = true;
    balances.set(
      payment.fromMemberId,
      (balances.get(payment.fromMemberId) || 0) + (payment.amount || 0)
    );
    balances.set(
      payment.toMemberId,
      (balances.get(payment.toMemberId) || 0) - (payment.amount || 0)
    );
  });

  return sawCurrency && Array.from(balances.values()).every((v) => Math.abs(v) <= 0.01);
}

async function ensureFriendDoc(ownerUid, friendUid) {
  const ref = db.doc(`users/${ownerUid}/friends/${friendUid}`);
  const existing = await ref.get();
  if (existing.exists) {
    await migrateFriendAliases(ownerUid, { id: existing.id, ...dataOf(existing) });
    return;
  }
  const profile = dataOf(await db.doc(`users/${friendUid}`).get());
  const friend = {
    id: friendUid,
    name: profile.displayName || profile.email || "SplitSync user",
    email: profile.email || "",
    phone: "",
    createdAt: now(),
    linkedUid: friendUid,
    createdByUid: friendUid,
  };
  await ref.set(friend);
  await migrateFriendAliases(ownerUid, friend);
}

async function migrateFriendAliases(ownerUid, canonicalFriend) {
  const friendsSnap = await db.collection(`users/${ownerUid}/friends`).get();
  const friends = friendsSnap.docs.map((doc) => ({ id: doc.id, ...dataOf(doc) }));
  const canonical = { ...canonicalFriend, id: canonicalFriend.id || strongUid(canonicalFriend) };
  const canonicalName = normalizeName(canonical.name);

  const strongSameName = friends.filter(
    (friend) =>
      normalizeName(friend.name) === canonicalName &&
      hasStrongFriendIdentity(friend)
  );
  const canAdoptNameOnly =
    Boolean(canonicalName) &&
    strongSameName.length > 0 &&
    strongSameName.every((friend) => stronglyMatchesFriend(friend, canonical));

  const aliases = friends.filter((friend) => {
    if (friend.id === canonical.id) return false;
    if (stronglyMatchesFriend(friend, canonical)) return true;
    return (
      canAdoptNameOnly &&
      !hasStrongFriendIdentity(friend) &&
      normalizeName(friend.name) === canonicalName
    );
  });

  if (aliases.length === 0) return;

  const aliasToCanonicalId = new Map(
    aliases.map((friend) => [friend.id, canonical.id])
  );
  aliasToCanonicalId.set(canonical.id, canonical.id);

  const [expensesSnap, paymentsSnap] = await Promise.all([
    db.collection(`users/${ownerUid}/adhocExpenses`).get(),
    db.collection(`users/${ownerUid}/adhocPayments`).get(),
  ]);

  const actions = [];

  expensesSnap.docs.forEach((doc) => {
    const expense = dataOf(doc);
    const paidByFriendId = canonicalParticipantId(
      expense.paidByFriendId,
      aliasToCanonicalId
    );
    const splits = canonicalAmountMap(expense.splits, aliasToCanonicalId);
    if (
      paidByFriendId !== expense.paidByFriendId ||
      !numberMapsEqual(splits, expense.splits)
    ) {
      actions.push((batch) => batch.update(doc.ref, { paidByFriendId, splits }));
    }
  });

  paymentsSnap.docs.forEach((doc) => {
    const payment = dataOf(doc);
    const fromFriendId = canonicalParticipantId(
      payment.fromFriendId,
      aliasToCanonicalId
    );
    const toFriendId = canonicalParticipantId(
      payment.toFriendId,
      aliasToCanonicalId
    );
    if (
      fromFriendId !== payment.fromFriendId ||
      toFriendId !== payment.toFriendId
    ) {
      actions.push((batch) =>
        batch.update(doc.ref, { fromFriendId, toFriendId })
      );
    }
  });

  aliases.forEach((friend) => {
    actions.push((batch) =>
      batch.delete(db.doc(`users/${ownerUid}/friends/${friend.id}`))
    );
  });

  await commitAdminActions(actions);
  logger.info("Migrated duplicate friend aliases", {
    ownerUid,
    canonicalFriendId: canonical.id,
    aliasIds: aliases.map((friend) => friend.id),
  });
}

async function linkedCounterparty(ownerUid, friendId) {
  if (!friendId || friendId === SELF) return null;
  const snap = await db.doc(`users/${ownerUid}/friends/${friendId}`).get();
  if (!snap.exists) return null;
  const friend = { id: snap.id, ...dataOf(snap) };
  return friend.linkedUid ? friend : null;
}

function counterpartyFromExpense(expense) {
  if (expense.paidByFriendId && expense.paidByFriendId !== SELF) {
    return expense.paidByFriendId;
  }
  return Object.keys(expense.splits || {}).find((id) => id !== SELF) || "";
}

function counterpartyFromPayment(payment) {
  if (payment.fromFriendId && payment.fromFriendId !== SELF) return payment.fromFriendId;
  if (payment.toFriendId && payment.toFriendId !== SELF) return payment.toFriendId;
  return "";
}

function mirroredParticipant(id, friendId, ownerUid) {
  if (id === SELF) return ownerUid;
  if (id === friendId) return SELF;
  return id;
}

function mirroredSplits(splits, friendId, ownerUid) {
  return Object.fromEntries(
    Object.entries(splits || {}).map(([id, amount]) => [
      mirroredParticipant(id, friendId, ownerUid),
      amount,
    ])
  );
}

async function mirrorAdHocExpense(ownerUid, expenseId, expense, friend) {
  await ensureFriendDoc(friend.linkedUid, ownerUid);
  const mirrorId = `${ownerUid}_${expenseId}`;
  await db.doc(`users/${friend.linkedUid}/adhocExpenses/${mirrorId}`).set({
    ...expense,
    id: mirrorId,
    paidByFriendId: mirroredParticipant(expense.paidByFriendId, friend.id, ownerUid),
    splits: mirroredSplits(expense.splits, friend.id, ownerUid),
    mirroredFromPath: `users/${ownerUid}/adhocExpenses/${expenseId}`,
    mirroredFromUid: ownerUid,
    originalId: expenseId,
  });
}

async function mirrorAdHocPayment(ownerUid, paymentId, payment, friend) {
  await ensureFriendDoc(friend.linkedUid, ownerUid);
  const mirrorId = `${ownerUid}_${paymentId}`;
  await db.doc(`users/${friend.linkedUid}/adhocPayments/${mirrorId}`).set({
    ...payment,
    id: mirrorId,
    fromFriendId: mirroredParticipant(payment.fromFriendId, friend.id, ownerUid),
    toFriendId: mirroredParticipant(payment.toFriendId, friend.id, ownerUid),
    mirroredFromPath: `users/${ownerUid}/adhocPayments/${paymentId}`,
    mirroredFromUid: ownerUid,
    originalId: paymentId,
  });
}

exports.onGroupInviteCreated = onDocumentCreatedWithAuthContext(
  "users/{uid}/groupInvites/{inviteId}",
  async (event) => {
    const invite = dataOf(event.data);
    await dispatchTo(event.params.uid, {
      type: "group_invite_received",
      title: `Invite to ${invite.groupName}`,
      body: `${actorName(invite.invitedByName)} invited you to join ${invite.groupName}.`,
      actorUid: invite.invitedByUid,
      targetUrl: "/dashboard",
      eventId: `users/${event.params.uid}/groupInvites/${event.params.inviteId}:created`,
      source: source("groupInvites", event.params.inviteId, {
        groupId: invite.groupId,
      }),
    });
  }
);

exports.onGroupMemberCreated = onDocumentCreatedWithAuthContext(
  "groups/{groupId}/members/{memberId}",
  async (event) => {
    const member = dataOf(event.data);
    if (!member.linkedUid) return;
    const ctx = await groupContext(event.params.groupId);
    if (!ctx) return;
    const actor = actorUid(event, member) || member.linkedUid;
    if (actor !== member.linkedUid) return;
    if (ctx.group.createdBy === actor && now() - (ctx.group.createdAt || 0) < 5 * 60 * 1000) {
      return;
    }
    const displayName = await userName(actor);
    await notifyGroupMembers(ctx, actor, () => ({
      type: "group_invite_accepted",
      title: `${actorName(displayName)} joined ${ctx.group.name}`,
      body: `${actorName(displayName)} accepted the invite to ${ctx.group.name}.`,
      actorUid: actor,
      targetUrl: `/groups/${ctx.group.id}`,
      eventId: `groups/${ctx.group.id}/members/${event.params.memberId}:joined`,
      source: source("members", event.params.memberId, { groupId: ctx.group.id }),
    }));
  }
);

exports.onGroupExpenseCreated = onDocumentCreatedWithAuthContext(
  "groups/{groupId}/expenses/{expenseId}",
  async (event) => {
    const expense = dataOf(event.data);
    const ctx = await groupContext(event.params.groupId);
    if (!ctx) return;
    const payer = ctx.memberById.get(expense.paidById);
    const actor = actorUid(event, expense) || payer?.linkedUid || "";
    const displayName = await userName(actor);

    await Promise.all(
      linkedMembers(ctx)
        .filter((member) => member.linkedUid !== actor)
        .map(async (member) => {
          const prefs = await preferencesFor(member.linkedUid);
          const tags = largeExpenseTags(prefs, expense.amount, expense.currency);
          const base = buildGroupExpenseNotification({
            expense,
            group: ctx.group,
            payerName: payer?.name || "someone",
            recipientMember: member,
            actorDisplayName: displayName,
            tags,
          });
          await dispatchTo(member.linkedUid, {
            ...base,
            actorUid: actor,
            eventId: `groups/${ctx.group.id}/expenses/${event.params.expenseId}:created`,
            source: source("expenses", event.params.expenseId, {
              groupId: ctx.group.id,
              currency: expense.currency,
              amount: expense.amount,
              tags,
            }),
          });
        })
    );
  }
);

exports.onGroupExpenseDeleted = onDocumentDeletedWithAuthContext(
  "groups/{groupId}/expenses/{expenseId}",
  async (event) => {
    const expense = dataOf(event.data);
    const ctx = await groupContext(event.params.groupId);
    if (!ctx) return;
    const actor = actorUid(event, expense);
    const displayName = await userName(actor);
    await notifyGroupMembers(ctx, actor, () => ({
      type: "group_expense_deleted",
      title: `Expense deleted in ${ctx.group.name}`,
      body: `${actorName(displayName)} deleted ${expense.description || "an expense"}. Balances were recalculated.`,
      actorUid: actor,
      targetUrl: `/groups/${ctx.group.id}`,
      eventId: `groups/${ctx.group.id}/expenses/${event.params.expenseId}:deleted`,
      source: source("expenses", event.params.expenseId, {
        groupId: ctx.group.id,
        currency: expense.currency,
        amount: expense.amount,
      }),
    }));
  }
);

exports.onGroupPaymentCreated = onDocumentCreatedWithAuthContext(
  "groups/{groupId}/payments/{paymentId}",
  async (event) => {
    const payment = dataOf(event.data);
    const ctx = await groupContext(event.params.groupId);
    if (!ctx) return;
    const from = ctx.memberById.get(payment.fromMemberId);
    const to = ctx.memberById.get(payment.toMemberId);
    const actor = actorUid(event, payment) || from?.linkedUid || to?.linkedUid || "";
    const displayName = await userName(actor);
    const amount = formatMoney(payment.amount, payment.currency);

    await notifyGroupMembers(ctx, actor, (member) => ({
      type: "group_settlement_created",
      title: `Settlement in ${ctx.group.name}`,
      body: `${actorName(displayName)} recorded ${from?.name || "Someone"} paid ${to?.name || "someone"} ${amount}.`,
      actorUid: actor,
      targetUrl: `/groups/${ctx.group.id}`,
      eventId: `groups/${ctx.group.id}/payments/${event.params.paymentId}:created`,
      source: source("payments", event.params.paymentId, {
        groupId: ctx.group.id,
        currency: payment.currency,
        amount: payment.amount,
        tags:
          member.id === payment.fromMemberId || member.id === payment.toMemberId
            ? ["direct_settlement"]
            : [],
      }),
    }));

    if (await isGroupSettled(ctx.group.id, payment.currency)) {
      await notifyGroupMembers(ctx, actor, () => ({
        type: "group_fully_settled",
        title: `${ctx.group.name} is settled up`,
        body: `All ${payment.currency} balances in ${ctx.group.name} are now clear.`,
        actorUid: actor,
        targetUrl: `/groups/${ctx.group.id}`,
        eventId: `groups/${ctx.group.id}/payments/${event.params.paymentId}:settled:${payment.currency}`,
        source: source("payments", event.params.paymentId, {
          groupId: ctx.group.id,
          currency: payment.currency,
        }),
      }));
    }
  }
);

exports.onGroupPaymentDeleted = onDocumentDeletedWithAuthContext(
  "groups/{groupId}/payments/{paymentId}",
  async (event) => {
    const payment = dataOf(event.data);
    const ctx = await groupContext(event.params.groupId);
    if (!ctx) return;
    const from = ctx.memberById.get(payment.fromMemberId);
    const to = ctx.memberById.get(payment.toMemberId);
    const actor = actorUid(event, payment);
    const displayName = await userName(actor);
    await notifyGroupMembers(ctx, actor, () => ({
      type: "group_settlement_deleted",
      title: `Settlement deleted in ${ctx.group.name}`,
      body: `${actorName(displayName)} deleted ${from?.name || "Someone"}'s settlement with ${to?.name || "someone"}.`,
      actorUid: actor,
      targetUrl: `/groups/${ctx.group.id}`,
      eventId: `groups/${ctx.group.id}/payments/${event.params.paymentId}:deleted`,
      source: source("payments", event.params.paymentId, {
        groupId: ctx.group.id,
        currency: payment.currency,
        amount: payment.amount,
      }),
    }));
  }
);

exports.onFriendCreated = onDocumentCreatedWithAuthContext(
  "users/{uid}/friends/{friendId}",
  async (event) => {
    const friend = dataOf(event.data);
    if (friend.linkedUid && event.params.friendId === friend.linkedUid) {
      await migrateFriendAliases(event.params.uid, {
        id: event.params.friendId,
        ...friend,
      });
    }

    const actor = actorUid(event, friend);
    if (!actor || actor === event.params.uid) return;
    if (friend.linkedUid !== actor || event.params.friendId !== actor) return;
    const displayName = await userName(actor);
    await dispatchTo(event.params.uid, {
      type: "friend_added",
      title: `${actorName(displayName)} added you`,
      body: `${actorName(displayName)} added you as a SplitSync friend.`,
      actorUid: actor,
      targetUrl: "/dashboard",
      eventId: `users/${event.params.uid}/friends/${event.params.friendId}:created`,
      source: source("friends", event.params.friendId),
    });
  }
);

exports.onAdHocExpenseCreated = onDocumentCreatedWithAuthContext(
  "users/{uid}/adhocExpenses/{expenseId}",
  async (event) => {
    const expense = dataOf(event.data);
    if (expense.mirroredFromPath) return;
    const ownerUid = event.params.uid;
    const actor = actorUid(event, expense) || ownerUid;
    const ownerDisplayName = await userName(ownerUid);
    const friendId = counterpartyFromExpense(expense);
    const friend = await linkedCounterparty(ownerUid, friendId);
    const amount = formatMoney(expense.amount, expense.currency);

    if (friend) {
      await mirrorAdHocExpense(ownerUid, event.params.expenseId, expense, friend);
      await dispatchTo(friend.linkedUid, {
        type: "adhoc_expense_created",
        title: `New expense with ${actorName(ownerDisplayName)}`,
        body: `${actorName(ownerDisplayName)} added ${expense.description} for ${amount}.`,
        actorUid: actor,
        targetUrl: "/dashboard",
        eventId: `users/${ownerUid}/adhocExpenses/${event.params.expenseId}:created`,
        source: source("adhocExpenses", event.params.expenseId, {
          currency: expense.currency,
          amount: expense.amount,
        }),
      });
    } else {
      await dispatchTo(ownerUid, {
        type: "adhoc_expense_created",
        title: "Friend expense saved",
        body: `${expense.description} was added for ${amount}.`,
        actorUid: actor,
        targetUrl: "/dashboard",
        eventId: `users/${ownerUid}/adhocExpenses/${event.params.expenseId}:created`,
        source: source("adhocExpenses", event.params.expenseId, {
          currency: expense.currency,
          amount: expense.amount,
        }),
      });
    }
  }
);

exports.onAdHocExpenseDeleted = onDocumentDeletedWithAuthContext(
  "users/{uid}/adhocExpenses/{expenseId}",
  async (event) => {
    const expense = dataOf(event.data);
    if (expense.mirroredFromPath) return;
    const ownerUid = event.params.uid;
    const actor = actorUid(event, expense) || ownerUid;
    const friendId = counterpartyFromExpense(expense);
    const friend = await linkedCounterparty(ownerUid, friendId);
    if (friend) {
      await db.doc(`users/${friend.linkedUid}/adhocExpenses/${ownerUid}_${event.params.expenseId}`).delete();
    }
    await dispatchTo(friend?.linkedUid || ownerUid, {
      type: "adhoc_expense_deleted",
      title: "Friend expense deleted",
      body: `${expense.description || "An expense"} was removed and balances were recalculated.`,
      actorUid: actor,
      targetUrl: "/dashboard",
      eventId: `users/${ownerUid}/adhocExpenses/${event.params.expenseId}:deleted`,
      source: source("adhocExpenses", event.params.expenseId, {
        currency: expense.currency,
        amount: expense.amount,
      }),
    });
  }
);

exports.onAdHocPaymentCreated = onDocumentCreatedWithAuthContext(
  "users/{uid}/adhocPayments/{paymentId}",
  async (event) => {
    const payment = dataOf(event.data);
    if (payment.mirroredFromPath) return;
    const ownerUid = event.params.uid;
    const actor = actorUid(event, payment) || ownerUid;
    const ownerDisplayName = await userName(ownerUid);
    const friendId = counterpartyFromPayment(payment);
    const friend = await linkedCounterparty(ownerUid, friendId);
    const amount = formatMoney(payment.amount, payment.currency);

    if (friend) {
      await mirrorAdHocPayment(ownerUid, event.params.paymentId, payment, friend);
      await dispatchTo(friend.linkedUid, {
        type: "adhoc_settlement_created",
        title: `Settlement with ${actorName(ownerDisplayName)}`,
        body: `${actorName(ownerDisplayName)} recorded a ${amount} settlement.`,
        actorUid: actor,
        targetUrl: "/dashboard",
        eventId: `users/${ownerUid}/adhocPayments/${event.params.paymentId}:created`,
        source: source("adhocPayments", event.params.paymentId, {
          currency: payment.currency,
          amount: payment.amount,
        }),
      });
    } else {
      await dispatchTo(ownerUid, {
        type: "adhoc_settlement_created",
        title: "Friend settlement recorded",
        body: `A ${amount} settlement was recorded.`,
        actorUid: actor,
        targetUrl: "/dashboard",
        eventId: `users/${ownerUid}/adhocPayments/${event.params.paymentId}:created`,
        source: source("adhocPayments", event.params.paymentId, {
          currency: payment.currency,
          amount: payment.amount,
        }),
      });
    }
  }
);

exports.onAdHocPaymentDeleted = onDocumentDeletedWithAuthContext(
  "users/{uid}/adhocPayments/{paymentId}",
  async (event) => {
    const payment = dataOf(event.data);
    if (payment.mirroredFromPath) return;
    const ownerUid = event.params.uid;
    const actor = actorUid(event, payment) || ownerUid;
    const friendId = counterpartyFromPayment(payment);
    const friend = await linkedCounterparty(ownerUid, friendId);
    if (friend) {
      await db.doc(`users/${friend.linkedUid}/adhocPayments/${ownerUid}_${event.params.paymentId}`).delete();
    }
    await dispatchTo(friend?.linkedUid || ownerUid, {
      type: "adhoc_settlement_deleted",
      title: "Friend settlement deleted",
      body: "A friend settlement was removed and balances were recalculated.",
      actorUid: actor,
      targetUrl: "/dashboard",
      eventId: `users/${ownerUid}/adhocPayments/${event.params.paymentId}:deleted`,
      source: source("adhocPayments", event.params.paymentId, {
        currency: payment.currency,
        amount: payment.amount,
      }),
    });
  }
);
