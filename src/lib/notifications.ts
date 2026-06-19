import type {
  NotificationChannelPreference,
  NotificationPreference,
  NotificationType,
} from "@/lib/models";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationType, string> = {
  group_invite_received: "Group invites",
  group_invite_accepted: "Invite accepted",
  group_expense_created: "Group expenses",
  group_expense_deleted: "Deleted group expenses",
  group_settlement_created: "Group settlements",
  group_settlement_deleted: "Deleted group settlements",
  group_fully_settled: "Group fully settled",
  friend_added: "Friend added",
  adhoc_expense_created: "Friend expenses",
  adhoc_expense_deleted: "Deleted friend expenses",
  adhoc_settlement_created: "Friend settlements",
  adhoc_settlement_deleted: "Deleted friend settlements",
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreference = {
  pushEnabled: false,
  eventChannels: {},
  largeExpenseThresholds: {},
  updatedAt: 0,
};

export function mergedNotificationPreferences(
  prefs: NotificationPreference | null
): NotificationPreference {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...prefs,
    eventChannels: prefs?.eventChannels ?? {},
    largeExpenseThresholds: prefs?.largeExpenseThresholds ?? {},
  };
}

export function channelPreference(
  prefs: NotificationPreference | null,
  type: NotificationType
): Required<NotificationChannelPreference> {
  const merged = mergedNotificationPreferences(prefs);
  const eventPref = merged.eventChannels[type];
  return {
    inApp: eventPref?.inApp !== false,
    push: eventPref?.push !== false && merged.pushEnabled,
  };
}
