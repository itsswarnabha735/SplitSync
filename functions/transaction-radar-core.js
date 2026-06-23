"use strict";

const DEFAULT_RETENTION_DAYS = 30;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const AI_RECOGNITION_VERSION = "gmail-ai-v1";
const DEFAULT_GMAIL_AI_MODEL = "gemini-2.5-flash";
const DEFAULT_AI_HIGH_CONFIDENCE = 0.82;
const DEFAULT_AI_MEDIUM_CONFIDENCE = 0.7;
const EXCLUSION_RE =
  /\b(?:otp|one[-\s]?time password|verification code|login|password|security alert|statement generated|monthly statement|e[-\s]?statement|offer|cashback offer|sale|reward points|limit increased|bill generated|newsletter|unsubscribe)\b/i;
const TRANSACTION_RE =
  /\b(?:spent|debited|charged|paid|payment|purchase|transaction|sent|received|credited|refund|reversal|cash withdrawal|atm withdrawal|receipt|invoice)\b/i;
const MONEY_RE =
  /(?:₹|rs\.?|inr|usd|\$|eur|€|gbp|£|cad|aud|jpy|¥)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:₹|rs\.?|inr|usd|eur|gbp|cad|aud|jpy)\b/i;
const COMPLETION_RE =
  /\b(?:spent|debited|charged|paid|payment successful|payment received|purchase successful|transaction successful|has been processed|receipt|order paid)\b/i;
const BILL_DUE_RE =
  /\b(?:amount due|minimum amount due|total due|due date|bill generated|invoice generated|payment due|outstanding balance|statement generated|monthly statement|e[-\s]?statement|new statement|statement balance)\b/i;
const HARD_SECURITY_RE =
  /\b(?:otp|one[-\s]?time password|verification code|login|password|security alert)\b/i;
const PROMO_ONLY_RE =
  /\b(?:offer|cashback offer|sale|reward points|limit increased|newsletter|unsubscribe)\b/i;
const DELIVERY_ONLY_RE =
  /\b(?:delivered|shipped|out for delivery|tracking|dispatch(?:ed)?|arriving|delivery update)\b/i;
const TRUSTED_TRANSACTIONAL_SENDER_RE =
  /\b(?:bank|card|alerts?|statement|transaction|upi|pay|payments?|receipt|receipts|invoice|orders?|uber|ola|swiggy|zomato|bigbasket|amazon|flipkart|razorpay|stripe|paypal|phonepe|paytm|gpay|googlepay|cred)\b/i;
const VALID_CATEGORIES = new Set([
  "food-dining",
  "groceries",
  "transport",
  "fuel",
  "shopping",
  "entertainment",
  "utilities",
  "travel",
  "health",
  "housing",
  "investments",
  "fees",
  "income",
  "transfers",
  "other",
]);
const CATEGORY_ALIASES = {
  "food": "food-dining",
  "food & dining": "food-dining",
  "dining": "food-dining",
  "ride": "transport",
  "rides": "transport",
  "cab": "transport",
  "cabs": "transport",
  "taxi": "transport",
  "petrol": "fuel",
  "gas": "fuel",
  "medicine": "health",
  "medical": "health",
  "bills": "utilities",
  "bill": "utilities",
  "transfer": "transfers",
  "refund": "transfers",
  "investment": "investments",
};

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
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Number(number.toFixed(4))));
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

function redactForAi(value, maxLength = 4000) {
  return normalizeWhitespace(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\+?\d[\d ()-]{8,}\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 10 ? "[phone]" : match;
    })
    .replace(/\b(?:\d[ -]?){12,19}\b/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 12 ? `****${digits.slice(-4)}` : match;
    })
    .slice(0, maxLength);
}

function cleanAiString(value, maxLength = 160) {
  if (typeof value !== "string") return "";
  return normalizeWhitespace(value).slice(0, maxLength);
}

function cleanAiStringOrNull(value, maxLength = 160) {
  const cleaned = cleanAiString(value, maxLength);
  return cleaned || null;
}

function normalizeCurrency(value) {
  const currency = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

function normalizeCategory(value) {
  const raw = String(value || "").trim().toLowerCase();
  const slug = raw.replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (VALID_CATEGORIES.has(slug)) return slug;
  if (CATEGORY_ALIASES[raw]) return CATEGORY_ALIASES[raw];
  if (CATEGORY_ALIASES[slug]) return CATEGORY_ALIASES[slug];
  return "other";
}

function parseTransactionTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function isTrustedTransactionalSender(input) {
  return TRUSTED_TRANSACTIONAL_SENDER_RE.test(
    [input.sender, input.subject].filter(Boolean).join(" ")
  );
}

function compactStringList(value, maxItems = 10, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => normalizeWhitespace(item).slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function compactEvidence(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const evidence = {
    amountText: cleanAiString(source.amountText, 120),
    merchantText: cleanAiString(source.merchantText, 160),
    dateText: cleanAiString(source.dateText, 120),
    completionText: cleanAiString(source.completionText, 160),
  };
  return Object.fromEntries(Object.entries(evidence).filter(([, item]) => item));
}

function gmailRecognitionEvidence(input) {
  const body = redactForAi(input.body || "", 4500);
  const snippet = redactForAi(input.snippet || "", 600);
  const subject = redactForAi(input.subject || "", 240);
  const sender = redactForAi(input.sender || "", 180);
  const receivedAt = Number(input.receivedAt) || Date.now();
  return {
    sender,
    subject,
    snippet,
    body,
    receivedAt,
    receivedAtIso: new Date(receivedAt).toISOString(),
    messageId: input.messageId || "",
    threadId: input.threadId || input.messageId || "",
  };
}

function prefilterGmailExpenseInput(input) {
  const compact = normalizeWhitespace(
    [input.subject, input.snippet, input.body].filter(Boolean).join("\n")
  );
  const reasonCodes = [];
  if (!compact) reasonCodes.push("empty_email");
  if (!MONEY_RE.test(compact)) reasonCodes.push("no_currency_amount");
  if (HARD_SECURITY_RE.test(compact)) reasonCodes.push("otp_or_security");
  if (PROMO_ONLY_RE.test(compact) && !COMPLETION_RE.test(compact)) {
    reasonCodes.push("promo_or_newsletter");
  }
  if (BILL_DUE_RE.test(compact)) reasonCodes.push("bill_due_or_statement");
  if (
    DELIVERY_ONLY_RE.test(compact) &&
    !COMPLETION_RE.test(compact) &&
    !/\b(?:paid|payment|charged|debited|spent|receipt)\b/i.test(compact)
  ) {
    reasonCodes.push("delivery_only");
  }
  if (!TRANSACTION_RE.test(compact) && !COMPLETION_RE.test(compact)) {
    reasonCodes.push("no_transaction_language");
  }
  return {
    ok: reasonCodes.length === 0,
    reasonCodes,
    evidence: gmailRecognitionEvidence(input),
  };
}

function buildGmailAiRecognitionPrompt(evidence) {
  return `You are SplitSync Gmail Transaction Radar. Decide whether this sanitized Gmail message contains a completed real-world expense paid by the user.

Return ONLY valid JSON with this exact shape:
{
  "isExpense": boolean,
  "expenseKind": "completed_spend" | "refund" | "transfer" | "cash_withdrawal" | "bill_generated" | "statement" | "promo" | "otp_security" | "unknown",
  "merchant": string | null,
  "amount": number | null,
  "currency": string | null,
  "transactionAt": string | null,
  "paymentInstrumentHint": string | null,
  "category": string | null,
  "confidence": number,
  "evidence": {
    "amountText": string | null,
    "merchantText": string | null,
    "dateText": string | null,
    "completionText": string | null
  },
  "rejectionReasonCodes": string[]
}

High-precision rules:
- Extract only completed spends already paid/charged/debited by the user.
- Prefer isExpense=false when uncertain.
- Do not treat order IDs, phone numbers, reward points, discounts, taxes, available balance, credit limit, due amount, statement total, invoice due total, delivery estimate, or promo amounts as the expense.
- Reject bill generated/due reminders, statements, OTP/security emails, promos/offers, refunds/credits, transfers, ATM withdrawals, newsletters, and delivery-only updates.
- Merchant, amount, transaction date, and completion must be grounded in exact evidence text from the email.
- If multiple amounts exist, choose the completed paid/debited/charged total, not balance, discount, tax, or points.
- India-specific examples include INR, UPI, card debit alerts, bank debit alerts, Swiggy, Zomato, Uber, BigBasket, Amazon, PhonePe, Paytm, GPay, and Razorpay receipts.
- Supported category values: food-dining, groceries, transport, fuel, shopping, entertainment, utilities, travel, health, housing, investments, fees, other.

Sanitized Gmail message:
Sender: ${evidence.sender}
Subject: ${evidence.subject}
Received at: ${evidence.receivedAtIso}
Snippet: ${evidence.snippet}
Body: ${evidence.body}`;
}

function parseGmailAiRecognitionJson(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?```\s*$/gm, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeGmailAiRecognition(value) {
  const data = parseGmailAiRecognitionJson(value);
  if (!data || typeof data !== "object") return null;
  const knownKinds = new Set([
    "completed_spend",
    "refund",
    "transfer",
    "cash_withdrawal",
    "bill_generated",
    "statement",
    "promo",
    "otp_security",
    "unknown",
  ]);
  const expenseKind = knownKinds.has(data.expenseKind)
    ? data.expenseKind
    : "unknown";
  return {
    isExpense: data.isExpense === true,
    expenseKind,
    merchant: cleanAiStringOrNull(data.merchant, 120),
    amount:
      typeof data.amount === "number" && Number.isFinite(data.amount)
        ? Math.abs(data.amount)
        : null,
    currency: normalizeCurrency(data.currency) || null,
    transactionAt: cleanAiStringOrNull(data.transactionAt, 80),
    paymentInstrumentHint: cleanAiStringOrNull(data.paymentInstrumentHint, 80),
    category: normalizeCategory(data.category),
    confidence: clamp(Number(data.confidence || 0)),
    evidence: compactEvidence(data.evidence),
    rejectionReasonCodes: compactStringList(data.rejectionReasonCodes, 10, 80),
  };
}

function candidateFromAiRecognition(input, recognition, options) {
  const now = options.now || Date.now();
  const highConfidence = Number(options.highConfidence || options.minConfidence) || DEFAULT_AI_HIGH_CONFIDENCE;
  const mediumConfidence = Number(options.mediumConfidence) || DEFAULT_AI_MEDIUM_CONFIDENCE;
  const evidence = recognition.evidence || {};
  const trustedSender = isTrustedTransactionalSender(input);
  if (!recognition.isExpense || recognition.expenseKind !== "completed_spend") return null;
  if (!recognition.amount || !recognition.currency || !recognition.merchant) return null;
  if (recognition.confidence < mediumConfidence) return null;
  if (!evidence.amountText) return null;
  if (!evidence.completionText && !trustedSender) return null;

  const merchant = recognition.merchant;
  const normalizedMerchant = normalizeMerchant(merchant) || "unknown";
  const transactionAt = parseTransactionTimestamp(
    recognition.transactionAt,
    input.receivedAt || now
  );
  const status = recognition.confidence >= highConfidence ? "suggested" : "new";
  const fingerprint = buildTransactionFingerprint({
    merchant: normalizedMerchant,
    amount: recognition.amount,
    currency: recognition.currency,
    transactionAt,
    sourceSender: input.sender,
  });
  const sourceWarnings =
    status === "new" ? ["medium-confidence-ai-recognition"] : [];
  return {
    id: input.messageId,
    userId: options.userId,
    source: "gmail",
    sourceMessageId: input.messageId,
    sourceThreadId: input.threadId || input.messageId,
    sourceSender: String(input.sender || "").trim().slice(0, 180),
    sourceSubjectHash: stableHash(input.subject || ""),
    rawSnippetRedacted: redactSnippet(input.snippet || input.subject || ""),
    merchant,
    normalizedMerchant,
    amount: recognition.amount,
    currency: recognition.currency,
    transactionAt,
    detectedAt: now,
    ...(recognition.paymentInstrumentHint
      ? { paymentInstrumentHint: recognition.paymentInstrumentHint }
      : {}),
    category: recognition.category || "other",
    candidateType: "spend",
    status,
    confidence: recognition.confidence,
    parseConfidence: recognition.confidence,
    contextConfidence: 0,
    duplicateConfidence: 0,
    fingerprint,
    sourceRetentionExpiresAt:
      now + (options.retentionDays || DEFAULT_RETENTION_DAYS) * MILLIS_PER_DAY,
    recognitionMode: "ai",
    recognitionModel: options.model || DEFAULT_GMAIL_AI_MODEL,
    recognitionVersion: AI_RECOGNITION_VERSION,
    recognitionReasonCodes: compactStringList(
      [
        "ai_completed_spend",
        status === "suggested" ? "high_confidence" : "medium_confidence",
        trustedSender ? "trusted_sender" : "",
        evidence.completionText ? "completion_evidence" : "",
      ].filter(Boolean),
      10,
      80
    ),
    recognitionEvidence: evidence,
    ...(sourceWarnings.length ? { sourceWarnings } : {}),
    updatedAt: now,
  };
}

async function recognizeGmailExpenseCandidate(input, options = {}) {
  const prefilter = prefilterGmailExpenseInput(input);
  if (!prefilter.ok) return null;
  if (options.aiEnabled === false) {
    return parseGmailTransactionCandidate(input, options);
  }
  if (typeof options.aiRecognize !== "function") return null;
  const prompt = buildGmailAiRecognitionPrompt(prefilter.evidence);
  let rawRecognition;
  try {
    rawRecognition = await options.aiRecognize({
      prompt,
      evidence: prefilter.evidence,
      model: options.model || DEFAULT_GMAIL_AI_MODEL,
    });
  } catch (err) {
    if (typeof options.onAiError === "function") options.onAiError(err);
    return null;
  }
  const recognition = normalizeGmailAiRecognition(rawRecognition);
  if (!recognition) return null;
  return candidateFromAiRecognition(input, recognition, options);
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
  const paymentInstrumentHint = derivePaymentInstrumentHint(compact);
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
    ...(paymentInstrumentHint ? { paymentInstrumentHint } : {}),
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
  DEFAULT_GMAIL_AI_MODEL,
  DEFAULT_AI_HIGH_CONFIDENCE,
  DEFAULT_AI_MEDIUM_CONFIDENCE,
  parseGmailTransactionCandidate,
  recognizeGmailExpenseCandidate,
  prefilterGmailExpenseInput,
  buildGmailAiRecognitionPrompt,
  parseGmailAiRecognitionJson,
  normalizeGmailAiRecognition,
  gmailMessageToInput,
  buildTransactionFingerprint,
  normalizeMerchant,
};
