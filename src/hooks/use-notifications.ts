"use client";

import { useEffect, useMemo, useState } from "react";

import type { Notification, NotificationPreference } from "@/lib/models";
import { mergedNotificationPreferences } from "@/lib/notifications";
import { useRepository } from "@/hooks/use-repository";

export function useNotifications() {
  const repo = useRepository();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    const unsub = repo.subscribeNotifications((items) => {
      setNotifications(items);
      setLoading(false);
    });
    return () => unsub();
  }, [repo]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  return {
    notifications,
    unreadCount,
    loading,
    markRead: (id: string) => repo?.markNotificationRead(id),
    markAllRead: () => repo?.markAllNotificationsRead(),
  };
}

export function useNotificationPreferences() {
  const repo = useRepository();
  const [preferences, setPreferences] =
    useState<NotificationPreference | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repo) return;
    setLoading(true);
    const unsub = repo.subscribeNotificationPreferences((next) => {
      setPreferences(next);
      setLoading(false);
    });
    return () => unsub();
  }, [repo]);

  return {
    preferences: mergedNotificationPreferences(preferences),
    loading,
    updatePreferences: (patch: Partial<NotificationPreference>) =>
      repo?.updateNotificationPreferences(patch),
  };
}
