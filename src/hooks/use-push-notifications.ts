"use client";

import { useCallback, useEffect, useState } from "react";

import { getFirebaseApp } from "@/lib/firebase";
import { useRepository } from "@/hooks/use-repository";
import { useNotificationPreferences } from "@/hooks/use-notifications";
import { useUiStore } from "@/stores/ui-store";

const TOKEN_HASH_KEY = "splitsync:fcm-token-hash";

async function tokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return btoa(token).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 160);
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  if (/Chrome/i.test(ua)) return "Chrome browser";
  if (/Safari/i.test(ua)) return "Safari browser";
  if (/Firefox/i.test(ua)) return "Firefox browser";
  if (/Edge/i.test(ua)) return "Edge browser";
  return "Web browser";
}

async function messagingModules() {
  const mod = await import("firebase/messaging");
  const supported = await mod.isSupported();
  return { ...mod, supported };
}

function pushSetupErrorMessage(err: unknown): string {
  const message =
    err instanceof Error ? err.message : "Could not enable browser push.";
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (
    code === "permission-denied" ||
    code === "firestore/permission-denied" ||
    message.includes("Missing or insufficient permissions")
  ) {
    return "Notification backend is not deployed yet. Deploy Firestore rules and Cloud Functions, then try again.";
  }
  return message;
}

export function usePushNotifications() {
  const repo = useRepository();
  const { preferences, updatePreferences } = useNotificationPreferences();
  const showToast = useUiStore((s) => s.showToast);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    messagingModules()
      .then(({ supported: ok }) => setSupported(ok))
      .catch(() => setSupported(false));
  }, []);

  const enable = useCallback(async () => {
    if (!repo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        throw new Error("Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY.");
      }
      const modules = await messagingModules();
      if (!modules.supported) {
        throw new Error("Browser push is not supported in this browser.");
      }
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }
      const registration = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      );
      const messaging = modules.getMessaging(getFirebaseApp());
      const token = await modules.getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
      if (!token) throw new Error("Could not create a browser push token.");
      const hash = await tokenHash(token);
      localStorage.setItem(TOKEN_HASH_KEY, hash);
      await repo.saveFcmToken({
        tokenHash: hash,
        token,
        deviceLabel: browserLabel(),
        userAgent: navigator.userAgent,
      });
      await updatePreferences({ pushEnabled: true });
      showToast({
        title: "Browser push enabled",
        body: "SplitSync can now notify this browser.",
      });
    } catch (err) {
      const message = pushSetupErrorMessage(err);
      setError(message);
      showToast({ title: "Push setup failed", body: message });
    } finally {
      setBusy(false);
    }
  }, [busy, repo, showToast, updatePreferences]);

  const disable = useCallback(async () => {
    if (!repo || busy) return;
    setBusy(true);
    setError(null);
    try {
      const modules = await messagingModules();
      if (modules.supported) {
        const messaging = modules.getMessaging(getFirebaseApp());
        await modules.deleteToken(messaging).catch(() => false);
      }
      const savedHash = localStorage.getItem(TOKEN_HASH_KEY);
      if (savedHash) {
        await repo.deleteFcmToken(savedHash);
        localStorage.removeItem(TOKEN_HASH_KEY);
      }
      await updatePreferences({ pushEnabled: false });
      showToast({
        title: "Browser push disabled",
        body: "This browser will only show in-app notifications.",
      });
    } catch (err) {
      const message = pushSetupErrorMessage(err);
      setError(message);
      showToast({ title: "Push update failed", body: message });
    } finally {
      setBusy(false);
    }
  }, [busy, repo, showToast, updatePreferences]);

  return {
    supported,
    permission,
    enabled: preferences.pushEnabled,
    busy,
    error,
    enable,
    disable,
  };
}

export function useForegroundPushMessages() {
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    messagingModules()
      .then((modules) => {
        if (!modules.supported) return;
        const messaging = modules.getMessaging(getFirebaseApp());
        unsub = modules.onMessage(messaging, (payload) => {
          showToast({
            title: payload.data?.title ?? "SplitSync",
            body: payload.data?.body ?? "You have a new notification.",
            targetUrl: payload.data?.url,
          });
        });
      })
      .catch(() => undefined);

    return () => unsub?.();
  }, [showToast]);
}
