/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js");

let messagingReady = null;

function openTarget(url) {
  const target = new URL(url || "/dashboard", self.location.origin).href;
  return clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client && client.url === target) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.type === "transaction_candidate_detected" && data.candidateId) {
    const action = event.action || "review";
    const url = new URL("/expense-inbox", self.location.origin);
    url.searchParams.set("candidateId", data.candidateId);
    if (action) url.searchParams.set("candidateAction", action);
    event.waitUntil(openTarget(url.pathname + url.search));
    return;
  }
  event.waitUntil(openTarget(data.url));
});

messagingReady = fetch("/api/firebase-config")
  .then((res) => res.json())
  .then((config) => {
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const isRadar = data.type === "transaction_candidate_detected";
      self.registration.showNotification(data.title || "SplitSync", {
        body: data.body || "You have a new notification.",
        actions: isRadar
          ? [
              { action: "add", title: "Add" },
              { action: "edit", title: "Edit" },
              { action: "personal", title: "Personal" },
              { action: "ignore", title: "Ignore" },
            ]
          : undefined,
        data: {
          url: data.url || "/dashboard",
          notificationId: data.notificationId,
          type: data.type,
          candidateId: data.candidateId,
        },
      });
    });
  })
  .catch((err) => {
    console.warn("[SplitSync] Could not initialize messaging service worker", err);
  });

self.addEventListener("push", (event) => {
  event.waitUntil(messagingReady);
});
