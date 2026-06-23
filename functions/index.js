"use strict";

const admin = require("firebase-admin");
const crypto = require("node:crypto");
const {
  onDocumentCreatedWithAuthContext,
  onDocumentDeletedWithAuthContext,
  onDocumentUpdatedWithAuthContext,
} = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const {
  notificationDocId,
  formatMoney,
  shouldSendChannel,
  largeExpenseTags,
  actorName,
  buildGroupExpenseNotification,
  buildMirroredAdHocExpense,
  buildSourceAdHocExpenseFromMirror,
  shouldHandleSourceAdHocDelete,
  sourcePathForAdHocMirrorDelete,
} = require("./notification-core");
const {
  GMAIL_QUERY,
  DEFAULT_GMAIL_AI_MODEL,
  DEFAULT_AI_HIGH_CONFIDENCE,
  DEFAULT_AI_MEDIUM_CONFIDENCE,
  gmailMessageToInput,
  recognizeGmailExpenseCandidate,
} = require("./transaction-radar-core");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const SELF = "self";
const GMAIL_OAUTH_CLIENT_SECRET = defineSecret("GMAIL_OAUTH_CLIENT_SECRET");
const GMAIL_TOKEN_ENCRYPTION_KEY = defineSecret("GMAIL_TOKEN_ENCRYPTION_KEY");
const GMAIL_OAUTH_STATE_SECRET = defineSecret("GMAIL_OAUTH_STATE_SECRET");
const GOOGLE_GEMINI_API_KEY = defineSecret("GOOGLE_GEMINI_API_KEY");
const gmailSecretOptions = {
  secrets: [
    GMAIL_OAUTH_CLIENT_SECRET,
    GMAIL_TOKEN_ENCRYPTION_KEY,
    GMAIL_OAUTH_STATE_SECRET,
  ],
};
const gmailRecognitionSecretOptions = {
  secrets: [...gmailSecretOptions.secrets, GOOGLE_GEMINI_API_KEY],
};
const GMAIL_PUBSUB_TOPIC_ID =
  process.env.GMAIL_PUBSUB_TOPIC_ID ||
  (process.env.GMAIL_PUBSUB_TOPIC || "").split("/").pop() ||
  "splitsync-gmail-radar";
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

function withoutUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((out, [key, item]) => {
      const cleaned = withoutUndefined(item);
      if (cleaned !== undefined) out[key] = cleaned;
      return out;
    }, {});
  }
  return value === undefined ? undefined : value;
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

const ADHOC_EXPENSE_SYNC_FIELDS = [
  "id",
  "description",
  "amount",
  "paidByFriendId",
  "splitType",
  "timestamp",
  "currency",
  "splits",
  "createdByUid",
  "category",
  "sourceType",
  "transactionCandidateId",
  "importBatchId",
  "transactionFingerprint",
  "parserMode",
  "parserConfidence",
  "notes",
  "sourceConfidence",
  "sourceWarnings",
  "createdAt",
  "updatedAt",
  "lastEditedByUid",
  "editCount",
  "mirroredFromPath",
  "mirroredFromUid",
  "originalId",
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableAdHocExpense(data = {}) {
  return ADHOC_EXPENSE_SYNC_FIELDS.reduce((out, field) => {
    if (data[field] !== undefined) out[field] = data[field];
    return out;
  }, {});
}

function adHocExpensesEqual(a = {}, b = {}) {
  return stableJson(comparableAdHocExpense(a)) === stableJson(comparableAdHocExpense(b));
}

async function writeAdHocExpenseIfChanged(ref, next) {
  const snap = await ref.get();
  if (snap.exists && adHocExpensesEqual(dataOf(snap), next)) return false;
  await ref.set(next);
  return true;
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
          candidateId:
            payload.type === "transaction_candidate_detected"
              ? payload.source?.id || ""
              : "",
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

function requireCallableAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in before using Gmail Radar.");
  }
  return uid;
}

function gmailConfig() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpsError(
      "failed-precondition",
      "Gmail OAuth is not configured on the server."
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function stateSecret() {
  return (
    process.env.GMAIL_OAUTH_STATE_SECRET ||
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY ||
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    "splitsync-local-gmail-state"
  );
}

function signState(uid) {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      nonce: crypto.randomBytes(12).toString("base64url"),
      iat: now(),
    })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifyState(state, uid) {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return false;
  const expected = crypto
    .createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.uid === uid && now() - (parsed.iat || 0) < 15 * 60 * 1000;
  } catch {
    return false;
  }
}

function tokenCipherKey() {
  const raw =
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY ||
    process.env.GMAIL_OAUTH_CLIENT_SECRET ||
    "splitsync-local-token-key";
  return crypto.createHash("sha256").update(raw).digest();
}

function sealSecret(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function openSecret(value) {
  if (!value) return "";
  const [prefix, version, ivRaw, tagRaw, encryptedRaw] = String(value).split(":");
  if (prefix !== "enc" || version !== "v1") return String(value);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    tokenCipherKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function gmailIntegrationRef(uid) {
  return db.doc(`users/${uid}/privateIntegrations/gmail`);
}

function radarSettingsRef(uid) {
  return db.doc(`users/${uid}/transactionRadarSettings/default`);
}

function uidFromGmailIntegrationRef(ref) {
  const match = ref.path.match(/^users\/([^/]+)\/privateIntegrations\/gmail$/);
  return match?.[1] || "";
}

function decodePubSubJson(message = {}) {
  if (message.json && typeof message.json === "object") return message.json;
  if (!message.data) return {};
  const data = Buffer.isBuffer(message.data)
    ? message.data.toString("utf8")
    : String(message.data);
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    } catch {
      return {};
    }
  }
}

async function gmailIntegrationDocsForEmail(emailAddress) {
  const normalized = normalizeEmail(emailAddress);
  if (!normalized) return [];
  const normalizedSnap = await db
    .collectionGroup("privateIntegrations")
    .where("normalizedGmailEmail", "==", normalized)
    .limit(20)
    .get();
  if (!normalizedSnap.empty) {
    return normalizedSnap.docs.filter((docSnap) => dataOf(docSnap).provider === "gmail");
  }

  const fallbackSnap = await db
    .collectionGroup("privateIntegrations")
    .where("provider", "==", "gmail")
    .limit(100)
    .get();
  return fallbackSnap.docs.filter(
    (docSnap) => normalizeEmail(dataOf(docSnap).gmailEmail) === normalized
  );
}

async function exchangeGmailCode(code) {
  const { clientId, clientSecret, redirectUri } = gmailConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpsError(
      "permission-denied",
      data.error_description || data.error || "Google rejected the Gmail authorization code."
    );
  }
  return data;
}

async function refreshGmailAccessToken(uid, integration) {
  if (
    integration.accessToken &&
    (integration.accessTokenExpiresAt || 0) > now() + 60 * 1000
  ) {
    return openSecret(integration.accessToken);
  }
  const { clientId, clientSecret } = gmailConfig();
  const refreshToken = openSecret(integration.refreshToken);
  if (!refreshToken) {
    throw new HttpsError("failed-precondition", "Reconnect Gmail to refresh access.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new HttpsError(
      "permission-denied",
      data.error_description || data.error || "Could not refresh Gmail access."
    );
  }
  await gmailIntegrationRef(uid).set(
    {
      accessToken: sealSecret(data.access_token),
      accessTokenExpiresAt: now() + (data.expires_in || 3600) * 1000,
      updatedAt: now(),
    },
    { merge: true }
  );
  return data.access_token;
}

async function gmailApi(accessToken, path, options = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpsError(
      "unavailable",
      data.error?.message || `Gmail API failed for ${path}.`
    );
  }
  return data;
}

function envFlag(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function gmailAiRecognitionConfig(settings = {}) {
  const enabled =
    settings.aiRecognitionEnabled !== false &&
    envFlag("GMAIL_AI_RECOGNITION_ENABLED", true);
  const highConfidence =
    typeof settings.aiRecognitionMinConfidence === "number"
      ? Math.max(0, Math.min(1, settings.aiRecognitionMinConfidence))
      : numberEnv(
          "GMAIL_AI_RECOGNITION_MIN_CONFIDENCE",
          DEFAULT_AI_HIGH_CONFIDENCE
        );
  return {
    enabled,
    model:
      settings.aiRecognitionModel ||
      process.env.GMAIL_AI_RECOGNITION_MODEL ||
      DEFAULT_GMAIL_AI_MODEL,
    highConfidence,
    mediumConfidence: DEFAULT_AI_MEDIUM_CONFIDENCE,
  };
}

async function recognizeGmailWithGemini({ prompt, model }) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini recognition is not configured.");
  }
  const generationConfig = {
    temperature: 0.05,
    topP: 0.8,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  };
  if (String(model).includes("2.5-flash")) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.error?.message || `Gemini recognition failed with ${response.status}.`
    );
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Gemini recognition returned an empty response.");
  return text;
}

async function ensureGmailWatch(uid, accessToken) {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) return null;
  const watch = await gmailApi(accessToken, "watch", {
    method: "POST",
    body: {
      topicName,
      labelIds: ["INBOX"],
      labelFilterBehavior: "INCLUDE",
    },
  });
  const expiresAt = Number(watch.expiration || 0);
  await Promise.all([
    gmailIntegrationRef(uid).set(
      {
        historyId: watch.historyId || "",
        gmailWatchExpiresAt: expiresAt,
        updatedAt: now(),
      },
      { merge: true }
    ),
    radarSettingsRef(uid).set(
      {
        gmailWatchExpiresAt: expiresAt,
        updatedAt: now(),
      },
      { merge: true }
    ),
  ]);
  return watch;
}

async function syncGmailForUid(uid, options = {}) {
  const integrationSnap = await gmailIntegrationRef(uid).get();
  if (!integrationSnap.exists) {
    throw new HttpsError("failed-precondition", "Connect Gmail before syncing.");
  }
  const settingsSnap = await radarSettingsRef(uid).get();
  const settings = settingsSnap.exists ? dataOf(settingsSnap) : {};
  if (settings.scanStatus === "paused" && !options.force) {
    return { scanned: 0, created: 0, skipped: 0, paused: true };
  }
  const integration = dataOf(integrationSnap);
  const accessToken = await refreshGmailAccessToken(uid, integration);
  const messageList = await gmailApi(accessToken, "messages", {
    query: {
      q: process.env.GMAIL_RADAR_QUERY || GMAIL_QUERY,
      maxResults: options.maxResults || 25,
    },
  });
  const ignored = new Set(settings.ignoredMerchants || []);
  const aiConfig = gmailAiRecognitionConfig(settings);
  let aiUnavailable = false;
  const aiRecognize =
    aiConfig.enabled && process.env.GOOGLE_GEMINI_API_KEY
      ? (request) =>
          recognizeGmailWithGemini({
            prompt: request.prompt,
            model: request.model || aiConfig.model,
          })
      : null;
  if (aiConfig.enabled && !aiRecognize) aiUnavailable = true;
  let scanned = 0;
  let created = 0;
  let skipped = 0;
  for (const item of messageList.messages || []) {
    scanned += 1;
    const candidateRef = db.doc(`users/${uid}/transactionCandidates/${item.id}`);
    const existing = await candidateRef.get();
    if (existing.exists) {
      skipped += 1;
      continue;
    }
    const message = await gmailApi(accessToken, `messages/${item.id}`, {
      query: { format: "full" },
    });
    const candidate = await recognizeGmailExpenseCandidate(
      gmailMessageToInput(message),
      {
        userId: uid,
        now: now(),
        retentionDays: settings.retentionDays || 30,
        aiEnabled: aiConfig.enabled,
        aiRecognize,
        model: aiConfig.model,
        highConfidence: aiConfig.highConfidence,
        mediumConfidence: aiConfig.mediumConfidence,
        onAiError: (err) => {
          aiUnavailable = true;
          logger.warn("Gmail AI recognition skipped message", {
            uid,
            messageId: item.id,
            error: err.message,
          });
        },
      }
    );
    if (!candidate || ignored.has(candidate.normalizedMerchant)) {
      skipped += 1;
      continue;
    }
    await candidateRef.set(withoutUndefined(candidate));
    created += 1;
  }
  await radarSettingsRef(uid).set(
    {
      gmailConnected: true,
      scanStatus: "active",
      lastSyncedAt: now(),
      lastSyncError: "",
      aiRecognitionEnabled: aiConfig.enabled,
      aiRecognitionModel: aiConfig.model,
      aiRecognitionMinConfidence: aiConfig.highConfidence,
      updatedAt: now(),
    },
    { merge: true }
  );
  if (aiUnavailable) {
    logger.warn("Gmail sync completed with AI recognition skips", {
      uid,
      scanned,
      created,
      skipped,
    });
  }
  return { scanned, created, skipped, paused: false };
}

async function notifyGroupMembers(ctx, excludedUid, payloadFactory) {
  await Promise.all(
    linkedMembers(ctx)
      .filter((member) => member.linkedUid !== excludedUid)
      .map((member) => dispatchTo(member.linkedUid, payloadFactory(member)))
  );
}

exports.createGmailOAuthUrl = onCall(gmailSecretOptions, async (request) => {
  const uid = requireCallableAuth(request);
  const { clientId, redirectUri } = gmailConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
  url.searchParams.set("state", signState(uid));
  return { url: url.toString() };
});

exports.finishGmailOAuth = onCall(gmailRecognitionSecretOptions, async (request) => {
  const uid = requireCallableAuth(request);
  const code = String(request.data?.code || "");
  const state = String(request.data?.state || "");
  if (!code || !verifyState(state, uid)) {
    throw new HttpsError("invalid-argument", "Invalid Gmail OAuth callback.");
  }
  const token = await exchangeGmailCode(code);
  const existing = await gmailIntegrationRef(uid).get();
  const existingData = existing.exists ? dataOf(existing) : {};
  const refreshToken = token.refresh_token
    ? sealSecret(token.refresh_token)
    : existingData.refreshToken || "";
  if (!refreshToken) {
    throw new HttpsError(
      "failed-precondition",
      "Google did not return a refresh token. Reconnect Gmail and approve offline access."
    );
  }
  const profile = await gmailApi(token.access_token, "profile");
  await gmailIntegrationRef(uid).set(
    {
      provider: "gmail",
      gmailEmail: profile.emailAddress || "",
      normalizedGmailEmail: normalizeEmail(profile.emailAddress || ""),
      refreshToken,
      accessToken: sealSecret(token.access_token),
      accessTokenExpiresAt: now() + (token.expires_in || 3600) * 1000,
      scope: token.scope || "",
      connectedAt: existingData.connectedAt || now(),
      updatedAt: now(),
    },
    { merge: true }
  );
  await radarSettingsRef(uid).set(
    {
      gmailConnected: true,
      gmailEmail: profile.emailAddress || "",
      scanStatus: "active",
      retentionDays: 30,
      rawEmailRetention: "24h",
      ignoredMerchants: [],
      activeFilters: [
        "bank-alerts",
        "card-receipts",
        "upi-confirmations",
        "merchant-receipts",
      ],
      connectedAt: now(),
      lastSyncError: "",
      aiRecognitionEnabled: envFlag("GMAIL_AI_RECOGNITION_ENABLED", true),
      aiRecognitionModel:
        process.env.GMAIL_AI_RECOGNITION_MODEL || DEFAULT_GMAIL_AI_MODEL,
      aiRecognitionMinConfidence: numberEnv(
        "GMAIL_AI_RECOGNITION_MIN_CONFIDENCE",
        DEFAULT_AI_HIGH_CONFIDENCE
      ),
      updatedAt: now(),
    },
    { merge: true }
  );
  await ensureGmailWatch(uid, token.access_token).catch((err) => {
    logger.warn("Gmail watch setup failed", { uid, error: err.message });
  });
  const sync = await syncGmailForUid(uid, { force: true, maxResults: 20 }).catch((err) => {
    logger.warn("Initial Gmail sync failed", { uid, error: err.message });
    return { scanned: 0, created: 0, skipped: 0, initialSyncError: err.message };
  });
  return { email: profile.emailAddress || "", sync };
});

exports.syncGmailTransactions = onCall(
  gmailRecognitionSecretOptions,
  async (request) => {
  const uid = requireCallableAuth(request);
  try {
    return await syncGmailForUid(uid, { force: true, maxResults: 30 });
  } catch (err) {
    await radarSettingsRef(uid).set(
      {
        lastSyncError: err.message || "Could not sync Gmail.",
        updatedAt: now(),
      },
      { merge: true }
    );
    throw err;
  }
});

exports.disconnectGmailRadar = onCall(async (request) => {
  const uid = requireCallableAuth(request);
  await Promise.all([
    gmailIntegrationRef(uid).delete(),
    radarSettingsRef(uid).set(
      {
        gmailConnected: false,
        gmailEmail: "",
        scanStatus: "disconnected",
        lastSyncError: "",
        gmailWatchExpiresAt: 0,
        updatedAt: now(),
      },
      { merge: true }
    ),
  ]);
  return { disconnected: true };
});

exports.syncActiveGmailConnections = onSchedule(
  { schedule: "every 10 minutes", secrets: gmailRecognitionSecretOptions.secrets },
  async () => {
    const snap = await db
      .collectionGroup("privateIntegrations")
      .where("provider", "==", "gmail")
      .limit(100)
      .get();
    await Promise.all(
      snap.docs.map(async (docSnap) => {
        const uid = uidFromGmailIntegrationRef(docSnap.ref);
        if (!uid) return;
        try {
          const integration = dataOf(docSnap);
          const normalizedGmailEmail = normalizeEmail(integration.gmailEmail);
          if (
            normalizedGmailEmail &&
            integration.normalizedGmailEmail !== normalizedGmailEmail
          ) {
            await docSnap.ref.set({ normalizedGmailEmail, updatedAt: now() }, { merge: true });
          }
          const accessToken = await refreshGmailAccessToken(uid, integration);
          if (
            process.env.GMAIL_PUBSUB_TOPIC &&
            (!integration.gmailWatchExpiresAt ||
              integration.gmailWatchExpiresAt < now() + 24 * 60 * 60 * 1000)
          ) {
            await ensureGmailWatch(uid, accessToken);
          }
          await syncGmailForUid(uid, { maxResults: 15 });
        } catch (err) {
          logger.warn("Scheduled Gmail sync failed", { uid, error: err.message });
          await radarSettingsRef(uid).set(
            {
              lastSyncError: err.message || "Scheduled Gmail sync failed.",
              updatedAt: now(),
            },
            { merge: true }
          );
        }
      })
    );
  }
);

exports.onGmailPushNotification = onMessagePublished(
  {
    topic: GMAIL_PUBSUB_TOPIC_ID,
    secrets: gmailRecognitionSecretOptions.secrets,
    retry: false,
  },
  async (event) => {
    const payload = decodePubSubJson(event.data?.message);
    const emailAddress = normalizeEmail(payload.emailAddress);
    const historyId = String(payload.historyId || "");
    const messageId = event.data?.message?.messageId || "";
    if (!emailAddress) {
      logger.warn("Gmail push notification missing emailAddress", { messageId });
      return;
    }

    const docs = await gmailIntegrationDocsForEmail(emailAddress);
    if (docs.length === 0) {
      logger.info("Gmail push notification had no matching integration", { historyId });
      return;
    }

    await Promise.all(
      docs.map(async (docSnap) => {
        const uid = uidFromGmailIntegrationRef(docSnap.ref);
        if (!uid) return;
        try {
          const sync = await syncGmailForUid(uid, { maxResults: 10 });
          const update = {
            lastPushAt: now(),
            normalizedGmailEmail: emailAddress,
            updatedAt: now(),
          };
          if (historyId) update.historyId = historyId;
          await docSnap.ref.set(update, { merge: true });
          logger.info("Gmail push sync completed", {
            uid,
            historyId,
            scanned: sync.scanned,
            created: sync.created,
            skipped: sync.skipped,
            paused: sync.paused,
          });
        } catch (err) {
          logger.warn("Gmail push sync failed", { uid, historyId, error: err.message });
          await radarSettingsRef(uid).set(
            {
              lastSyncError: err.message || "Gmail push sync failed.",
              updatedAt: now(),
            },
            { merge: true }
          );
        }
      })
    );
  }
);

exports.cleanupExpiredTransactionCandidates = onSchedule("every 24 hours", async () => {
  const snap = await db
    .collectionGroup("transactionCandidates")
    .where("sourceRetentionExpiresAt", "<=", now())
    .limit(300)
    .get();
  const batch = db.batch();
  let count = 0;
  snap.docs.forEach((docSnap) => {
    const data = dataOf(docSnap);
    if (data.status === "added" || data.status === "expired") return;
    batch.update(docSnap.ref, {
      status: "expired",
      rawSnippetRedacted: "[expired]",
      updatedAt: now(),
    });
    count += 1;
  });
  if (count > 0) await batch.commit();
  logger.info("Expired Transaction Radar candidates", { count });
});

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
  const mirrorRef = db.doc(`users/${friend.linkedUid}/adhocExpenses/${mirrorId}`);
  await writeAdHocExpenseIfChanged(
    mirrorRef,
    buildMirroredAdHocExpense(expense, {
      mirrorId,
      sourceOwnerUid: ownerUid,
      sourceExpenseId: expenseId,
      sourceFriendId: friend.id,
    })
  );
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

async function syncSourceAdHocExpenseUpdate(ownerUid, expenseId, before, after) {
  const beforeFriend = await linkedCounterparty(ownerUid, counterpartyFromExpense(before));
  const afterFriend = await linkedCounterparty(ownerUid, counterpartyFromExpense(after));

  if (
    beforeFriend &&
    (!afterFriend || beforeFriend.linkedUid !== afterFriend.linkedUid)
  ) {
    await db
      .doc(`users/${beforeFriend.linkedUid}/adhocExpenses/${ownerUid}_${expenseId}`)
      .delete();
  }

  if (afterFriend) {
    await mirrorAdHocExpense(ownerUid, expenseId, after, afterFriend);
  }
}

async function syncMirrorAdHocExpenseUpdate(mirrorExpense) {
  if (!mirrorExpense.mirroredFromPath || !mirrorExpense.mirroredFromUid) return;
  const sourceRef = db.doc(mirrorExpense.mirroredFromPath);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) return;

  const sourceExpense = dataOf(sourceSnap);
  const sourceOwnerUid = mirrorExpense.mirroredFromUid;
  const sourceExpenseId = mirrorExpense.originalId || sourceRef.id;
  const sourceFriendId = counterpartyFromExpense(sourceExpense);
  if (!sourceFriendId) return;

  await writeAdHocExpenseIfChanged(
    sourceRef,
    buildSourceAdHocExpenseFromMirror(mirrorExpense, {
      sourceOwnerUid,
      sourceExpenseId,
      sourceFriendId,
    })
  );
}

async function deleteSourceForAdHocMirror(mirrorDoc, collectionName) {
  const sourcePath = sourcePathForAdHocMirrorDelete(mirrorDoc, collectionName);
  if (!sourcePath) return false;
  await db.doc(sourcePath).delete();
  return true;
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

exports.onTransactionCandidateCreated = onDocumentCreatedWithAuthContext(
  "users/{uid}/transactionCandidates/{candidateId}",
  async (event) => {
    const candidate = dataOf(event.data);
    if (candidate.status !== "suggested") return;
    if ((candidate.confidence || 0) < 0.75) return;

    const targetName = candidate.suggestedTarget?.targetName;
    const merchant = candidate.merchant || "Transaction";
    const amount = formatMoney(candidate.amount, candidate.currency);
    const body = targetName
      ? `${merchant} ${amount} detected. Add to ${targetName}?`
      : `${merchant} ${amount} detected. Review in Expense Inbox.`;

    await dispatchTo(event.params.uid, {
      type: "transaction_candidate_detected",
      title: "Possible shared expense",
      body,
      actorUid: event.params.uid,
      targetUrl: "/expense-inbox",
      eventId: `users/${event.params.uid}/transactionCandidates/${event.params.candidateId}:created`,
      source: source("transactionCandidates", event.params.candidateId, {
        currency: candidate.currency,
        amount: candidate.amount,
        targetKind: candidate.suggestedTarget?.kind || "",
        targetId: candidate.suggestedTarget?.targetId || "",
      }),
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

exports.onAdHocExpenseUpdated = onDocumentUpdatedWithAuthContext(
  "users/{uid}/adhocExpenses/{expenseId}",
  async (event) => {
    const before = dataOf(event.data?.before);
    const after = dataOf(event.data?.after);
    if (!after.id) after.id = event.params.expenseId;

    if (after.mirroredFromPath) {
      await syncMirrorAdHocExpenseUpdate(after);
      return;
    }

    await syncSourceAdHocExpenseUpdate(
      event.params.uid,
      event.params.expenseId,
      before,
      after
    );
  }
);

exports.onAdHocExpenseDeleted = onDocumentDeletedWithAuthContext(
  "users/{uid}/adhocExpenses/{expenseId}",
  async (event) => {
    const expense = dataOf(event.data);
    if (!shouldHandleSourceAdHocDelete(expense)) {
      await deleteSourceForAdHocMirror(expense, "adhocExpenses");
      return;
    }
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
    if (!shouldHandleSourceAdHocDelete(payment)) {
      await deleteSourceForAdHocMirror(payment, "adhocPayments");
      return;
    }
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
