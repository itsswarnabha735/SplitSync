"use strict";

const EVENT_TYPES = [
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

function notificationDocId(eventId, uid) {
  return Buffer.from(`${eventId}:${uid}`).toString("base64url").slice(0, 900);
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount || 0);
  } catch {
    return `${currency || "USD"} ${(amount || 0).toFixed(2)}`;
  }
}

function shouldSendChannel(preferences, type, channel) {
  const eventPref = preferences?.eventChannels?.[type];
  if (channel === "push" && preferences?.pushEnabled !== true) return false;
  return eventPref?.[channel] !== false;
}

function largeExpenseTags(preferences, amount, currency) {
  const threshold = preferences?.largeExpenseThresholds?.[currency];
  if (typeof threshold !== "number" || threshold <= 0) return [];
  return amount >= threshold ? ["large_expense"] : [];
}

function actorName(name) {
  return name && name.trim() ? name.trim() : "Someone";
}

function buildGroupExpenseNotification({
  expense,
  group,
  payerName,
  recipientMember,
  actorDisplayName,
  tags = [],
}) {
  const share = expense.splits?.[recipientMember.id] || 0;
  const amount = formatMoney(expense.amount, expense.currency);
  const owes = share > 0 ? ` Your share is ${formatMoney(share, expense.currency)}.` : "";
  return {
    type: "group_expense_created",
    title: tags.includes("large_expense")
      ? `Large expense in ${group.name}`
      : `New expense in ${group.name}`,
    body: `${actorName(actorDisplayName)} added ${expense.description} for ${amount}, paid by ${payerName}.${owes}`,
    targetUrl: `/groups/${group.id}`,
  };
}

module.exports = {
  EVENT_TYPES,
  notificationDocId,
  formatMoney,
  shouldSendChannel,
  largeExpenseTags,
  actorName,
  buildGroupExpenseNotification,
};
