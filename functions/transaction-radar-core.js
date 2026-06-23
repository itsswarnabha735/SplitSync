"use strict";

const DEFAULT_RETENTION_DAYS = 30;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const EXCLUSION_RE =
  /\b(?:otp|one[-\s]?time password|verification code|login|password|statement generated|monthly statement|e[-\s]?statement|offer|cashback offer|sale|reward points|limit increased|bill generated)\b/i;
const TRANSACTION_RE =
  /\b(?:spent|debited|charged|paid|payment|purchase|transaction|sent|received|credited|refund|reversal|cash withdrawal|atm withdrawal|receipt|invoice)\b/i;
const MONEY_RE =
  /(?:₹|rs\.?|inr|usd|\$|eur|€|gbp|£|cad|aud|jpy|¥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:₹|rs\.?|inr|usd|eur|gbp|cad|aud|jpy)\b/i;

const GMAIL_QUERY =
  'newer_than:14d (spent OR debited OR charged OR paid OR payment OR purchase OR receipt OR invoice OR transaction) -otp -offer -"statement generated" -"monthly statement"';

function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeMerchant(value = "") {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\b(?:pvt|ltd|private|limited|payments?|online|india|upi|pos)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeSender(value = "") {
  return String(value).toLowerCase().replace(/^.*<|>.*$/g, "").trim();
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stableHash(value = "") {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function firstMoneyMatch(text) {
  const match = MONEY_RE.exec(text);
  if (!match) return null;
  const rawAmount = match[1] || match[2];
  const amount = Number(rawAmount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const raw = match[0].toLowerCase();
  const currency =
    raw.includes("₹") || raw.includes("rs") || raw.includes("inr")
      ? "INR"
      : raw.includes("€") || raw.includes("eur")
        ? "EUR"
        : raw.includes("£") || raw.includes("gbp")
          ? "GBP"
          : raw.includes("cad")
            ? "CAD"
            : raw.includes("aud")
              ? "AUD"
              : raw.includes("¥") || raw.includes("jpy")
                ? "JPY"
                : "USD";
  return { amount, currency, index: match.index };
}

function cleanMerchant(value) {
  return normalizeWhitespace(value)
    .replace(/\b(?:for|of|using|via|on|dated|ref|txn|transaction).*$/i, "")
    .replace(/[^A-Za-z0-9 &.'-]+$/g, "")
    .trim()
    .slice(0, 80);
}

function deriveMerchant(text, sender, amountIndex) {
  const patterns = [
    /\b(?:at|to|towards|on)\s+([A-Z0-9][A-Za-z0-9 &.'-]{2,60})/i,
    /\b(?:merchant|payee|biller)\s*[:\-]\s*([A-Z0-9][A-Za-z0-9 &.'-]{2,60})/i,
    /\b(?:from)\s+([A-Z0-9][A-Za-z0-9 &.'-]{2,60})\s+(?:for|of)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanMerchant(match[1]);
  }
  const window = text.slice(Math.max(0, amountIndex - 80), amountIndex + 120);
  const titleCase = /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})\b/.exec(window);
  if (titleCase?.[1] && !/dear|card|account|transaction|payment/i.test(titleCase[1])) {
    return cleanMerchant(titleCase[1]);
  }
  return cleanMerchant(String(sender).split("@")[0].replace(/[._-]+/g, " "));
}

function classifyCandidate(text) {
  if (/\b(?:refund|reversal|credited|cashback received)\b/i.test(text)) return "refund";
  if (/\b(?:sent|transfer(?:red)?|neft|imps|rtgs|upi transfer)\b/i.test(text)) return "transfer";
  if (/\b(?:atm|cash withdrawal)\b/i.test(text)) return "cash-withdrawal";
  if (/\b(?:spent|debited|charged|paid|purchase|payment|receipt)\b/i.test(text)) return "spend";
  return "unknown";
}

function monthIndex(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric - 1);
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((item) =>
    String(value).toLowerCase().startsWith(item)
  );
  return Math.max(0, idx);
}

function deriveTransactionTime(text, fallback) {
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  const dmy = /\b(\d{1,2})[-/ ]([A-Za-z]{3,}|\d{1,2})[-/ ](20\d{2})\b/.exec(text);
  if (dmy) {
    const date = new Date(Number(dmy[3]), monthIndex(dmy[2]), Number(dmy[1]));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return fallback;
}

function derivePaymentInstrumentHint(text) {
  const card = /\b(?:card|xx|ending)\s*(?:no\.?|number)?\s*(?:ending)?\s*(?:with|in)?\s*(?:x{2,}|[*]+)?\s*(\d{4})\b/i.exec(text);
  if (card?.[1]) return `Card ending ${card[1]}`;
  if (/\bupi\b/i.test(text)) return "UPI";
  if (/\bnetbanking|net banking\b/i.test(text)) return "NetBanking";
  return undefined;
}

function redactSnippet(value) {
  return normalizeWhitespace(value)
    .replace(/\b\d{10,}\b/g, "[number]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .slice(0, 260);
}

function buildTransactionFingerprint(params) {
  return [
    dateKey(params.transactionAt),
    normalizeMerchant(params.merchant),
    Math.round(Math.abs(params.amount) * 100),
    String(params.currency || "USD").toUpperCase(),
    normalizeSender(params.sourceSender || ""),
  ].join("|");
}

function parseGmailTransactionCandidate(input, options) {
  const now = options.now || Date.now();
  const compact = normalizeWhitespace(
    [input.subject, input.snippet, input.body].filter(Boolean).join("\n")
  );
  if (!TRANSACTION_RE.test(compact)) return null;
  if (EXCLUSION_RE.test(compact)) return null;
  const amountMatch = firstMoneyMatch(compact);
  if (!amountMatch) return null;
  const merchant = deriveMerchant(compact, input.sender, amountMatch.index) || "Unknown merchant";
  const normalizedMerchant = normalizeMerchant(merchant) || "unknown";
  const candidateType = classifyCandidate(compact);
  const transactionAt = deriveTransactionTime(compact, input.receivedAt || now);
  const parseConfidence = clamp(
    0.45 +
      (merchant ? 0.18 : 0) +
      (candidateType === "spend" ? 0.16 : 0) +
      (input.sender ? 0.08 : 0) +
      (transactionAt ? 0.08 : 0)
  );
  const status = candidateType === "spend" && parseConfidence >= 0.68 ? "suggested" : "new";
  const fingerprint = buildTransactionFingerprint({
    merchant: normalizedMerchant,
    amount: amountMatch.amount,
    currency: amountMatch.currency,
    transactionAt,
    sourceSender: input.sender,
  });
  return {
    id: input.messageId,
    userId: options.userId,
    source: "gmail",
    sourceMessageId: input.messageId,
    sourceThreadId: input.threadId || input.messageId,
    sourceSender: String(input.sender || "").trim().slice(0, 180),
    sourceSubjectHash: stableHash(input.subject || ""),
    rawSnippetRedacted: redactSnippet(input.snippet || input.subject || compact),
    merchant,
    normalizedMerchant,
    amount: amountMatch.amount,
    currency: amountMatch.currency,
    transactionAt,
    detectedAt: now,
    paymentInstrumentHint: derivePaymentInstrumentHint(compact),
    category: "other",
    candidateType,
    status,
    confidence: parseConfidence,
    parseConfidence,
    contextConfidence: 0,
    duplicateConfidence: 0,
    fingerprint,
    sourceRetentionExpiresAt:
      now + (options.retentionDays || DEFAULT_RETENTION_DAYS) * MILLIS_PER_DAY,
    updatedAt: now,
  };
}

function base64UrlDecode(data = "") {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(value = "") {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function headerValue(message, name) {
  const header = message?.payload?.headers?.find(
    (item) => String(item.name || "").toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

function collectMessageBody(payload) {
  if (!payload) return "";
  const chunks = [];
  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || "";
    if (part.body?.data) {
      const text = base64UrlDecode(part.body.data);
      chunks.push(mimeType.includes("html") ? stripHtml(text) : text);
    }
    (part.parts || []).forEach(walk);
  }
  walk(payload);
  return normalizeWhitespace(chunks.join("\n"));
}

function gmailMessageToInput(message) {
  const subject = headerValue(message, "Subject");
  const sender = headerValue(message, "From");
  const dateHeader = headerValue(message, "Date");
  const parsedDate = Date.parse(dateHeader);
  return {
    messageId: message.id,
    threadId: message.threadId,
    sender,
    subject,
    snippet: message.snippet || "",
    body: collectMessageBody(message.payload),
    receivedAt: Number.isNaN(parsedDate) ? Number(message.internalDate) || Date.now() : parsedDate,
  };
}

module.exports = {
  GMAIL_QUERY,
  parseGmailTransactionCandidate,
  gmailMessageToInput,
  buildTransactionFingerprint,
  normalizeMerchant,
};
