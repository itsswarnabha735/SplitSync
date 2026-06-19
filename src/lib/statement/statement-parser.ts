/**
 * Statement Parser for Vault-AI
 *
 * Parses bank and credit card statements into individual transaction
 * line items. Uses a hybrid approach of regex patterns and heuristics
 * to detect tabular data in statement text.
 *
 * Supports:
 * - Credit card statements (Visa, Mastercard, Amex, etc.)
 * - Bank account statements (checking, savings)
 * - Various date formats (US, EU, ISO)
 * - Multiple currency formats
 * - Debit/credit/payment/fee detection
 *
 * PRIVACY: All parsing happens locally in the browser.
 * No statement data is ever transmitted to external servers.
 */

import type {
  DocumentTypeDetection,
  ParsedStatementTransaction,
  StatementParseResult,
  StatementParserOptions,
} from './types';
import { autoCategorizer } from './auto-categorizer';

// ============================================
// Constants - Document Type Detection
// ============================================

/**
 * Keywords that indicate a document is a financial statement.
 * Organized by specificity (more specific = higher confidence boost).
 */
const STATEMENT_KEYWORDS: Array<{ keyword: string; weight: number }> = [
  // High-confidence statement indicators
  { keyword: 'statement period', weight: 0.95 },
  { keyword: 'account statement', weight: 0.95 },
  { keyword: 'credit card statement', weight: 0.98 },
  { keyword: 'bank statement', weight: 0.98 },
  { keyword: 'billing statement', weight: 0.95 },
  { keyword: 'statement date', weight: 0.9 },
  { keyword: 'statement of account', weight: 0.95 },
  { keyword: 'statement of transactions', weight: 0.98 }, // Indian banks (ICICI, HDFC, SBI)
  { keyword: 'account summary', weight: 0.88 },
  { keyword: 'summary of accounts', weight: 0.88 }, // ICICI ("Summary of Accounts held")
  { keyword: 'transaction history', weight: 0.9 },
  { keyword: 'account activity', weight: 0.88 },

  // Medium-confidence indicators
  { keyword: 'opening balance', weight: 0.85 },
  { keyword: 'closing balance', weight: 0.85 },
  { keyword: 'previous balance', weight: 0.85 },
  { keyword: 'new balance', weight: 0.82 },
  { keyword: 'minimum payment', weight: 0.88 },
  { keyword: 'payment due', weight: 0.85 },
  { keyword: 'credit limit', weight: 0.88 },
  { keyword: 'available credit', weight: 0.85 },
  { keyword: 'amount due', weight: 0.78 },
  { keyword: 'total due', weight: 0.78 },
  { keyword: 'account number', weight: 0.75 },
  { keyword: 'savings account', weight: 0.8 }, // Indian bank savings statement
  { keyword: 'current account', weight: 0.8 }, // Indian bank current account statement
  { keyword: 'for the period', weight: 0.75 }, // "...for the period Jan 01 - Jan 31"

  // Indian bank-specific column headers (strong indicator)
  { keyword: 'particulars', weight: 0.7 }, // ICICI/SBI/HDFC column header
  { keyword: 'withdrawals', weight: 0.65 }, // ICICI: "DEPOSITS WITHDRAWALS BALANCE"
  { keyword: 'deposits', weight: 0.55 },

  // Lower-confidence indicators (common in statements but also in other docs)
  { keyword: 'transactions', weight: 0.6 },
  { keyword: 'purchases', weight: 0.55 },
  { keyword: 'payments', weight: 0.5 },
  { keyword: 'credits', weight: 0.45 },
  { keyword: 'debits', weight: 0.45 },
];

/**
 * Keywords indicating a receipt (not a statement).
 */
const RECEIPT_KEYWORDS = [
  'receipt',
  'subtotal',
  'tax',
  'tip',
  'gratuity',
  'thank you for your purchase',
  'order #',
  'order number',
  'item',
  'qty',
  'quantity',
  'unit price',
];

/**
 * Keywords indicating an invoice.
 */
const INVOICE_KEYWORDS = [
  'invoice',
  'bill to',
  'ship to',
  'due date',
  'invoice number',
  'inv #',
  'inv-',
  'remittance',
  'pay this amount',
];

/**
 * Known bank/issuer patterns for detection.
 */
const ISSUER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // ==========================================
  // IMPORTANT: Order matters! First match wins.
  // More specific patterns (multi-word, fintech) come BEFORE
  // generic single-word patterns to prevent false positives.
  // ==========================================

  // Indian Fintech / NBFC Card Issuers (specific names first)
  { pattern: /scapia/i, name: 'Scapia' },
  { pattern: /\bcred\s*(?:mint|card|club)\b/i, name: 'CRED' },
  { pattern: /\bkiwi\s*card\b/i, name: 'Kiwi' },
  { pattern: /sbi\s*card/i, name: 'SBI Card' },
  { pattern: /bob\s*card|bob\s*financial/i, name: 'BOB Financial' },
  { pattern: /onecard|one\s*card/i, name: 'OneCard' },
  { pattern: /\bslice\s*(?:card|pay)\b/i, name: 'Slice' },
  { pattern: /uni\s*card/i, name: 'Uni Card' },
  { pattern: /fi\.money|fi\s*money/i, name: 'Fi Money' },
  { pattern: /niyo\s*(?:global)?/i, name: 'Niyo' },
  { pattern: /freo\s*(?:pay|save)?/i, name: 'Freo' },
  { pattern: /freecharge/i, name: 'Freecharge' },
  { pattern: /lazypay/i, name: 'LazyPay' },
  { pattern: /\bsimpl\s*(?:pay|card)\b/i, name: 'Simpl' },
  { pattern: /zestmoney|zest\s*money/i, name: 'ZestMoney' },
  { pattern: /\bjupiter\s*(?:money|bank|card|fin)\b/i, name: 'Jupiter' },
  { pattern: /bajaj\s*finserv/i, name: 'Bajaj Finserv' },
  { pattern: /tata\s*neu/i, name: 'Tata Neu' },
  { pattern: /paytm/i, name: 'Paytm' },

  // Indian Banks - Private Sector (multi-word patterns first)
  { pattern: /hdfc\s*bank|hdfc\s*credit|hdfc\s*card/i, name: 'HDFC' },
  { pattern: /icici\s*bank|icici\s*credit|icici\s*card/i, name: 'ICICI' },
  { pattern: /axis\s*bank/i, name: 'Axis Bank' },
  {
    pattern: /kotak\s*mahindra|kotak\s*bank|kotak\s*card/i,
    name: 'Kotak Mahindra',
  },
  { pattern: /yes\s*bank/i, name: 'Yes Bank' },
  { pattern: /indusind/i, name: 'IndusInd' },
  { pattern: /rbl\s*bank/i, name: 'RBL Bank' },
  { pattern: /idfc\s*first/i, name: 'IDFC First' },
  { pattern: /federal\s*bank/i, name: 'Federal Bank' },
  { pattern: /bandhan\s*bank/i, name: 'Bandhan Bank' },
  { pattern: /karur\s*vysya|kvb\b/i, name: 'Karur Vysya Bank' },
  { pattern: /south\s*indian\s*bank/i, name: 'South Indian Bank' },
  { pattern: /catholic\s*syrian|csb\s*bank/i, name: 'CSB Bank' },
  { pattern: /city\s*union\s*bank|cub\b/i, name: 'City Union Bank' },
  { pattern: /dhanlaxmi/i, name: 'Dhanlaxmi Bank' },
  { pattern: /tamilnad\s*mercantile|tmb\b/i, name: 'Tamilnad Mercantile Bank' },
  { pattern: /nainital\s*bank/i, name: 'Nainital Bank' },
  {
    pattern: /jammu\s*(?:&|and)\s*kashmir|j\s*&?\s*k\s*bank/i,
    name: 'J&K Bank',
  },
  { pattern: /lakshmi\s*vilas/i, name: 'Lakshmi Vilas Bank' },
  // Broader fallback for HDFC / ICICI (if multi-word didn't match)
  { pattern: /\bhdfc\b/i, name: 'HDFC' },
  { pattern: /\bicici\b/i, name: 'ICICI' },
  { pattern: /\bkotak\b/i, name: 'Kotak Mahindra' },

  // Indian Banks - Public Sector (PSU)
  { pattern: /state\s*bank\s*of\s*india|sbi\b/i, name: 'SBI' },
  { pattern: /punjab\s*national\s*bank|pnb\b/i, name: 'Punjab National Bank' },
  { pattern: /bank\s*of\s*baroda/i, name: 'Bank of Baroda' },
  { pattern: /canara\s*bank/i, name: 'Canara Bank' },
  { pattern: /union\s*bank\s*of\s*india/i, name: 'Union Bank of India' },
  { pattern: /indian\s*bank\b/i, name: 'Indian Bank' },
  { pattern: /bank\s*of\s*india\b/i, name: 'Bank of India' },
  { pattern: /bank\s*of\s*maharashtra/i, name: 'Bank of Maharashtra' },
  { pattern: /central\s*bank\s*of\s*india/i, name: 'Central Bank of India' },
  { pattern: /indian\s*overseas\s*bank|iob\b/i, name: 'Indian Overseas Bank' },
  { pattern: /uco\s*bank/i, name: 'UCO Bank' },
  { pattern: /punjab\s*(?:&|and)\s*sind/i, name: 'Punjab & Sind Bank' },
  { pattern: /idbi\s*bank/i, name: 'IDBI Bank' },

  // Indian Small Finance Banks
  {
    pattern: /au\s*(?:small\s*finance)?\s*bank/i,
    name: 'AU Small Finance Bank',
  },
  { pattern: /equitas/i, name: 'Equitas Small Finance Bank' },
  { pattern: /ujjivan/i, name: 'Ujjivan Small Finance Bank' },
  {
    pattern: /jana\s*(?:small\s*finance)?\s*bank/i,
    name: 'Jana Small Finance Bank',
  },
  { pattern: /suryoday/i, name: 'Suryoday Small Finance Bank' },
  { pattern: /fincare/i, name: 'Fincare Small Finance Bank' },
  { pattern: /north\s*east\s*small\s*finance/i, name: 'NE Small Finance Bank' },

  // US Banks (with word boundaries to avoid false positives)
  {
    pattern: /\bchase\s*(?:bank|card|credit|sapphire|freedom|ink)\b/i,
    name: 'Chase',
  },
  { pattern: /\bjp\s*morgan\s*chase\b/i, name: 'Chase' },
  { pattern: /bank\s*of\s*america|bofa/i, name: 'Bank of America' },
  { pattern: /wells?\s*fargo/i, name: 'Wells Fargo' },
  { pattern: /citibank|citi\b/i, name: 'Citibank' },
  { pattern: /capital\s*one/i, name: 'Capital One' },
  { pattern: /discover\s*(?:bank|card|it|financial)/i, name: 'Discover' },
  { pattern: /usaa/i, name: 'USAA' },
  { pattern: /us\s*bank/i, name: 'US Bank' },
  { pattern: /td\s*bank/i, name: 'TD Bank' },
  { pattern: /\bpnc\s*(?:bank|financial)/i, name: 'PNC' },
  { pattern: /\bally\s*(?:bank|financial)/i, name: 'Ally' },
  { pattern: /synchrony/i, name: 'Synchrony' },
  { pattern: /barclays/i, name: 'Barclays' },
  // Broader fallback for "Chase" — requires word boundary
  { pattern: /\bchase\b/i, name: 'Chase' },

  // Foreign Banks Operating in India
  { pattern: /hsbc/i, name: 'HSBC' },
  { pattern: /standard\s*chartered|scb\b/i, name: 'Standard Chartered' },
  { pattern: /deutsche\s*bank/i, name: 'Deutsche Bank' },
  { pattern: /dbs\s*bank/i, name: 'DBS Bank' },

  // UK/EU Banks
  { pattern: /natwest/i, name: 'NatWest' },
  { pattern: /lloyds/i, name: 'Lloyds' },
  { pattern: /monzo/i, name: 'Monzo' },
  { pattern: /revolut/i, name: 'Revolut' },

  // Card Networks (fallback - checked last)
  { pattern: /american\s*express|amex/i, name: 'American Express' },
  { pattern: /diners\s*club/i, name: 'Diners Club' },
  { pattern: /\bvisa\b/i, name: 'Visa' },
  { pattern: /mastercard|master\s*card/i, name: 'Mastercard' },
  { pattern: /\bjcb\b/i, name: 'JCB' },
  { pattern: /unionpay|union\s*pay/i, name: 'UnionPay' },
  { pattern: /rupay/i, name: 'RuPay' },
];

// ============================================
// Constants - Transaction Line Parsing
// ============================================

/**
 * Month name mapping (same as entity-extractor).
 */
const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Patterns for extracting dates from statement transaction lines.
 * These are more constrained than the entity-extractor patterns
 * because we know we're looking at tabular data.
 *
 * Phase 4A: Smart DD/MM vs MM/DD disambiguation.
 * - If first number > 12, it MUST be a day (DD/MM)
 * - If second number > 12, it MUST be a day (MM/DD)
 * - If ambiguous (both <= 12), uses the `preferDDMM` context flag
 *   (set to true for Indian statements detected by issuer/currency)
 *
 * NOTE: The `preferDDMM` flag is injected by the parsing context.
 * Date patterns are defined as factory functions that accept this flag.
 */

/** Creates date patterns based on whether DD/MM should be preferred for ambiguous dates */
function createLineDatePatterns(preferDDMM: boolean): Array<{
  regex: RegExp;
  parser: (
    match: RegExpMatchArray
  ) => { year: number; month: number; day: number } | null;
}> {
  /**
   * Disambiguate two numeric date parts when both could be day or month.
   * Uses the preferDDMM flag from statement context.
   */
  function disambiguateDate(first: number, second: number, year: number) {
    // Unambiguous: first > 12 means it must be a day
    if (first > 12 && second <= 12) {
      return { year, month: second, day: first };
    }
    // Unambiguous: second > 12 means it must be a day
    if (second > 12 && first <= 12) {
      return { year, month: first, day: second };
    }
    // Ambiguous: use context-based preference
    if (preferDDMM) {
      return { year, month: second, day: first }; // DD/MM (Indian)
    }
    return { year, month: first, day: second }; // MM/DD (US)
  }

  return [
    // YYYY-MM-DD (ISO) - unambiguous, always parsed first
    {
      regex: /^(\d{4})-(\d{1,2})-(\d{1,2})/,
      parser: (m: RegExpMatchArray) => ({
        year: parseInt(m[1] ?? '0', 10),
        month: parseInt(m[2] ?? '0', 10),
        day: parseInt(m[3] ?? '0', 10),
      }),
    },
    // DD Mon YYYY or DD-Mon-YYYY (e.g., 15 Jan 2026, 15-Jan-2026) — unambiguous
    {
      regex:
        /^(\d{1,2})[\s\-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s\-.,](\d{2,4})/i,
      parser: (m: RegExpMatchArray) => {
        const month = MONTH_MAP[m[2]?.toLowerCase() ?? ''];
        if (!month) {
          return null;
        }
        let year = parseInt(m[3] ?? '0', 10);
        if (year < 100) {
          year = year > 50 ? 1900 + year : 2000 + year;
        }
        return { year, month, day: parseInt(m[1] ?? '0', 10) };
      },
    },
    // Mon DD, YYYY (e.g., Jan 15, 2026) — unambiguous
    {
      regex:
        /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i,
      parser: (m: RegExpMatchArray) => {
        const month = MONTH_MAP[m[1]?.toLowerCase() ?? ''];
        if (!month) {
          return null;
        }
        return {
          year: parseInt(m[3] ?? '0', 10),
          month,
          day: parseInt(m[2] ?? '0', 10),
        };
      },
    },
    // N/N/YYYY or N-N-YYYY — context-aware disambiguation
    {
      regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
      parser: (m: RegExpMatchArray) => {
        const first = parseInt(m[1] ?? '0', 10);
        const second = parseInt(m[2] ?? '0', 10);
        const year = parseInt(m[3] ?? '0', 10);
        return disambiguateDate(first, second, year);
      },
    },
    // N/N/YY or N-N-YY (with 2-digit year)
    {
      regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
      parser: (m: RegExpMatchArray) => {
        const first = parseInt(m[1] ?? '0', 10);
        const second = parseInt(m[2] ?? '0', 10);
        let year = parseInt(m[3] ?? '0', 10);
        year = year > 50 ? 1900 + year : 2000 + year;
        return disambiguateDate(first, second, year);
      },
    },
    // DD.MM.YYYY (European dot notation) — always DD.MM
    {
      regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,
      parser: (m: RegExpMatchArray) => {
        let year = parseInt(m[3] ?? '0', 10);
        if (year < 100) {
          year = year > 50 ? 1900 + year : 2000 + year;
        }
        return {
          year,
          month: parseInt(m[2] ?? '0', 10),
          day: parseInt(m[1] ?? '0', 10),
        };
      },
    },
    // N/N (no year — common in statements where year is known from header)
    {
      regex: /^(\d{1,2})\/(\d{1,2})\s/,
      parser: (m: RegExpMatchArray) => {
        const first = parseInt(m[1] ?? '0', 10);
        const second = parseInt(m[2] ?? '0', 10);
        const year = new Date().getFullYear();
        return disambiguateDate(first, second, year);
      },
    },
  ];
}

// Default patterns for lineHasDate check (uses MM/DD as safe default)
const LINE_DATE_PATTERNS = createLineDatePatterns(false);

/**
 * Parse an amount string, handling both Western (1,234,567.89) and
 * Indian lakh notation (1,23,456.78 or 12,34,567.89).
 * Phase 4B: Proper lakh notation support.
 */
function parseAmountString(amountStr: string): number {
  // Remove all commas (works for both Western and Indian notation)
  return parseFloat(amountStr.replace(/,/g, ''));
}

/**
 * Patterns for extracting amounts from the end of statement lines.
 * Phase 4B: Added Indian lakh notation support (1,23,456.78).
 */
const LINE_AMOUNT_PATTERNS: Array<{
  regex: RegExp;
  extractor: (match: RegExpMatchArray) => { amount: number; isCredit: boolean };
}> = [
  // Explicit credit with CR suffix: 1,23,456.78 CR or 1,234.56 CR
  {
    regex: /([\d,]+\.?\d*)\s*CR\s*$/i,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: true,
    }),
  },
  // Explicit credit: -$1,234.56 or ($1,234.56) or -₹1,23,456.78
  {
    regex: /[-\(]\s*[\$€£₹]?\s*([\d,]+\.?\d*)\s*\)?$/i,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: true,
    }),
  },
  // Debit with minus at end: 1,234.56- or 1,23,456.78-
  {
    regex: /([\d,]+\.?\d*)\s*-\s*$/,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: true,
    }),
  },
  // DR suffix (Indian debit indicator): 1,23,456.78 DR
  {
    regex: /([\d,]+\.?\d*)\s*DR\s*$/i,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: false,
    }),
  },
  // Indian format with currency: ₹1,23,456.78 or Rs. 1,23,456.78 or INR 1,23,456.78
  {
    regex: /(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)\s*$/i,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: false,
    }),
  },
  // Indian format with currency + CR: ₹1,23,456.78 CR
  {
    regex: /(?:₹|Rs\.?|INR)\s*([\d,]+\.?\d*)\s*CR\s*$/i,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: true,
    }),
  },
  // Standard amount with Western currency symbol: $1,234.56 or €1,234.56
  {
    regex: /[\$€£]\s*([\d,]+\.?\d*)\s*$/,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: false,
    }),
  },
  // Two amounts at end (debit and credit columns): amount1  amount2
  {
    regex: /\s([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/,
    extractor: (m) => {
      const amt1 = parseAmountString(m[1] ?? '0');
      const amt2 = parseAmountString(m[2] ?? '0');
      // Usually debit column first, credit column second
      if (amt1 > 0 && amt2 === 0) {
        return { amount: amt1, isCredit: false };
      }
      if (amt2 > 0 && amt1 === 0) {
        return { amount: amt2, isCredit: true };
      }
      // Both non-zero: first is debit
      return { amount: amt1, isCredit: false };
    },
  },
  // Plain amount at end of line (last resort): 1,234.56 or 1,23,456.78 or 1234.56
  {
    regex: /\s([\d,]+\.\d{2})\s*$/,
    extractor: (m) => ({
      amount: parseAmountString(m[1] ?? '0'),
      isCredit: false,
    }),
  },
];

/**
 * Keywords that indicate a credit/refund transaction.
 */
const CREDIT_KEYWORDS = [
  'payment',
  'credit',
  'refund',
  'return',
  'reversal',
  'cashback',
  'cash back',
  'reward',
  'adjustment',
  'deposit',
  'received',
  'cr',
  'neft transfer',
  'neft',
  'rtgs',
  'salary',
  'income',
];

/**
 * Lines to skip - headers, footers, totals, non-transaction noise, etc.
 * These patterns eliminate garbage lines that would otherwise get
 * partially parsed as false-positive transactions.
 */
const SKIP_LINE_PATTERNS: RegExp[] = [
  // --- Structural / Formatting ---
  /^\s*$/, // Empty lines
  /^[-=_*]{3,}$/, // Separator lines
  /^page\s+\d/i, // Page numbers
  /^\s*\*{2,}/, // Asterisk lines
  /^\s*continued/i, // Continuation markers
  /^\s*(?:\d+\s*of\s*\d+)\s*$/i, // "1 of 3" pagination

  // --- Column Headers ---
  /^\s*(?:date|description|amount|debit|credit|balance|reference|particulars|sr\.?\s*no|transaction\s*details?)\s*$/i,
  /^\s*(?:date)\s+(?:description|particulars|transaction)/i, // Multi-word column headers
  /^\s*(?:sl|sr|s)\.?\s*no\.?\s+date/i, // "Sl No  Date  Description..." header row

  // --- Totals / Balances ---
  /^\s*(?:total|subtotal|grand total|net)\s/i, // Total lines
  /^\s*(?:opening|closing|previous|new)\s+balance/i, // Balance lines
  /\bB\s*\/\s*F\b/i, // Brought Forward balance lines
  /\bC\s*\/\s*F\b/i, // Carried Forward balance lines
  /\b(?:brought|carried)\s+forward\b/i, // Brought/Carried Forward (verbose)
  /^\s*(?:minimum|payment|amount)\s+(?:due|payable)/i, // Payment due lines
  /^\s*(?:credit limit|available credit|cash limit)/i, // Limit lines
  /^\s*(?:total\s+)?(?:reward|loyalty)\s*points?/i, // Reward points lines

  // --- Statement Metadata ---
  /^\s*(?:statement|billing)\s+(?:period|date|cycle)/i, // Header lines
  /^\s*(?:account|card)\s+(?:number|no|holder)/i, // Account info
  /^\s*(?:interest|finance)\s+(?:charge|rate)/i, // Interest info lines
  /^\s*(?:customer\s+(?:id|name|care)|member\s+since)/i, // Customer info
  /^\s*(?:payment\s+due\s+date|due\s+date|last\s+date)/i, // Due date lines
  /^\s*(?:generated|printed|issued)\s+(?:on|date)/i, // Generation date

  // --- Contact Information ---
  /^\s*(?:phone|tel|fax|toll\s*free|helpline|customer\s*care)\s*[:\-]?\s*[\d\+\-\(\)]/i, // Phone numbers
  /^\s*(?:email|e-mail)\s*[:\-]?\s*\S+@\S+/i, // Email addresses
  /^\s*(?:website|web|url|visit)\s*[:\-]?\s*(?:www|https?)/i, // URLs
  /^\s*(?:www\.|https?:\/\/)/i, // Direct URLs

  // --- Physical Addresses ---
  /^\s*(?:address|regd\.?\s*office|corporate\s*office|head\s*office)\s*[:\-]/i, // Address labels
  /^\s*(?:p\.?o\.?\s*box|pin\s*code|zip\s*code)\s*[:\-]?\s*\d/i, // PO Box / PIN
  /^\s*(?:\d+[,\s]+(?:floor|street|road|lane|nagar|marg|colony|sector))/i, // Street addresses
  /^\s*(?:mumbai|delhi|bangalore|bengaluru|chennai|kolkata|hyderabad|pune|new\s*delhi|noida|gurgaon|gurugram)\s*[-,]?\s*\d{6}/i, // Indian city + pincode

  // --- Informational / Legal Paragraphs ---
  /^\s*(?:dear|respected)\s+(?:customer|cardholder|card\s*member|sir|madam)/i, // Salutations
  /^\s*(?:this\s+is\s+(?:a\s+)?(?:computer|system|auto)\s*(?:generated|produced))/i, // Auto-generated disclaimer
  /^\s*(?:for\s+any\s+(?:queries|dispute|clarification|assistance))/i, // Support text
  /^\s*(?:please\s+(?:note|contact|call|visit|refer|check))/i, // Instructions
  /^\s*(?:terms\s+(?:and|&)\s+conditions|t\s*&\s*c\s*apply)/i, // T&C
  /^\s*(?:important\s+(?:notice|information|update))/i, // Notices
  /^\s*(?:in\s+case\s+of|if\s+you\s+(?:have|need|wish))/i, // Conditional instructions
  /^\s*(?:registered\s+(?:office|with)|cin|gstin|gst\s*no)/i, // Legal registration
  /^\s*(?:subject\s+to\s+(?:terms|conditions|jurisdiction))/i, // Legal disclaimers

  // --- Rewards / Marketing / Promotions ---
  /^\s*(?:you\s+(?:have\s+)?earned|points?\s+(?:earned|redeemed|balance))/i,
  /^\s*(?:cashback|reward)\s+(?:earned|credited|summary)/i,
  /^\s*(?:offer|promo|promotion|discount|exclusive)\s/i, // Promotional lines
  /^\s*(?:emi\s+(?:conversion|available|details?))/i, // EMI conversion offers

  // --- Itemized Breakdowns / Sub-details ---
  /^\s*(?:gst|cgst|sgst|igst|tax|vat|service\s*tax)\s*(?:@|:|\d)/i, // Tax breakdowns
  /^\s*(?:cess|surcharge|convenience\s*fee|processing\s*fee)\s*[:\-]?\s*[\d₹$]/i, // Fee sub-items
  /^\s*(?:foreign\s*(?:currency|exchange)|conversion\s*rate|exchange\s*rate)/i, // FX details
  /^\s*(?:arn|approval\s*code|auth\s*code|ref\s*no|reference\s*(?:number|no))\s*[:\-]?\s*\w/i, // Reference codes (standalone)
  /^\s*(?:merchant\s*(?:category|id|name)|mcc)\s*[:\-]/i, // MCC details
  /^\s*(?:cross\s*currency|markup|mark-up)\s*[:\-]?\s*[\d]/i, // Cross-currency markup
];

// ============================================
// Statement Parser Service
// ============================================

/**
 * Statement parsing service.
 */
class StatementParserService {
  // ============================================
  // Public API
  // ============================================

  /**
   * Detect the type of a financial document.
   */
  detectDocumentType(text: string): DocumentTypeDetection {
    const textLower = text.toLowerCase();

    // Count keyword matches for each type
    let statementScore = 0;
    let receiptScore = 0;
    let invoiceScore = 0;
    const matchedKeywords: string[] = [];

    // Check statement keywords (weighted)
    for (const { keyword, weight } of STATEMENT_KEYWORDS) {
      if (textLower.includes(keyword)) {
        statementScore += weight;
        matchedKeywords.push(keyword);
      }
    }

    // Check receipt keywords
    for (const keyword of RECEIPT_KEYWORDS) {
      if (textLower.includes(keyword)) {
        receiptScore += 0.5;
      }
    }

    // Check invoice keywords
    for (const keyword of INVOICE_KEYWORDS) {
      if (textLower.includes(keyword)) {
        invoiceScore += 0.6;
      }
    }

    // Heuristic: statements tend to have many lines with dates and amounts.
    // Phase 5: Also detect multi-line formats (ICICI, HDFC, SBI) where
    // dates and amounts appear on DIFFERENT lines.
    const lines = text.split('\n');
    let linesWithDatesAndAmounts = 0;
    let linesWithDateOnly = 0;
    let linesWithAmountOnly = 0;
    for (const line of lines) {
      const hasDate = this.lineHasDate(line);
      const hasAmount = this.lineHasAmount(line);
      if (hasDate && hasAmount) {
        linesWithDatesAndAmounts++;
      }
      if (hasDate && !hasAmount) {
        linesWithDateOnly++;
      }
      if (!hasDate && hasAmount) {
        linesWithAmountOnly++;
      }
    }

    // Single-line format: dates and amounts on the same line
    if (linesWithDatesAndAmounts >= 5) {
      statementScore += 2.0;
    } else if (linesWithDatesAndAmounts >= 3) {
      statementScore += 1.0;
    }

    // Multi-line format (ICICI, HDFC, SBI etc.): dates on one line, amounts on another.
    // If we see many date-only lines AND many amount-only lines, it's a statement.
    if (
      linesWithDateOnly >= 5 &&
      linesWithAmountOnly >= 5 &&
      Math.abs(linesWithDateOnly - linesWithAmountOnly) < linesWithDateOnly
    ) {
      statementScore += 2.0;
    } else if (linesWithDateOnly >= 3 && linesWithAmountOnly >= 3) {
      statementScore += 1.0;
    }

    // Determine type
    const maxScore = Math.max(statementScore, receiptScore, invoiceScore);

    // Detect issuer
    const issuer = this.detectIssuer(text);

    if (maxScore === 0) {
      return {
        type: 'unknown',
        confidence: 0.3,
        matchedKeywords: [],
        issuer,
      };
    }

    if (statementScore >= receiptScore && statementScore >= invoiceScore) {
      const confidence = Math.min(0.99, statementScore / 5);
      return {
        type: 'statement',
        confidence,
        matchedKeywords,
        issuer,
      };
    }

    if (invoiceScore >= receiptScore) {
      return {
        type: 'invoice',
        confidence: Math.min(0.95, invoiceScore / 3),
        matchedKeywords,
        issuer,
      };
    }

    return {
      type: 'receipt',
      confidence: Math.min(0.95, receiptScore / 3),
      matchedKeywords,
      issuer,
    };
  }

  /**
   * Known Indian issuers for DD/MM date preference detection.
   */
  private static readonly INDIAN_ISSUERS = new Set([
    // Private sector banks
    'HDFC',
    'ICICI',
    'SBI',
    'Axis Bank',
    'Kotak Mahindra',
    'Yes Bank',
    'IndusInd',
    'RBL Bank',
    'IDFC First',
    'Federal Bank',
    'Bandhan Bank',
    'Karur Vysya Bank',
    'South Indian Bank',
    'CSB Bank',
    'City Union Bank',
    'Dhanlaxmi Bank',
    'Tamilnad Mercantile Bank',
    'Nainital Bank',
    'J&K Bank',
    'Lakshmi Vilas Bank',
    // PSU banks
    'Punjab National Bank',
    'Bank of Baroda',
    'Canara Bank',
    'Union Bank of India',
    'Indian Bank',
    'Bank of India',
    'Bank of Maharashtra',
    'Central Bank of India',
    'Indian Overseas Bank',
    'UCO Bank',
    'Punjab & Sind Bank',
    'IDBI Bank',
    // Small finance banks
    'AU Small Finance Bank',
    'Equitas Small Finance Bank',
    'Ujjivan Small Finance Bank',
    'Jana Small Finance Bank',
    'Suryoday Small Finance Bank',
    'Fincare Small Finance Bank',
    'NE Small Finance Bank',
    // Fintech / NBFC issuers
    'SBI Card',
    'BOB Financial',
    'OneCard',
    'Slice',
    'Uni Card',
    'Fi Money',
    'Jupiter',
    'Bajaj Finserv',
    'Tata Neu',
    'Paytm',
    'Scapia',
    'CRED',
    'Kiwi',
    'Niyo',
    'Freo',
    'Freecharge',
    'LazyPay',
    'Simpl',
    'ZestMoney',
    // Indian card network
    'RuPay',
  ]);

  /**
   * Detect whether this statement uses DD/MM date format (Indian convention).
   */
  private isIndianStatement(
    issuer: string | null,
    currency: string | null
  ): boolean {
    if (currency === 'INR') {
      return true;
    }
    if (issuer && StatementParserService.INDIAN_ISSUERS.has(issuer)) {
      return true;
    }
    return false;
  }

  /**
   * Parse a financial statement into individual transactions.
   */
  parseStatement(
    text: string,
    options: StatementParserOptions = {}
  ): StatementParseResult {
    const startTime = performance.now();

    const {
      defaultCurrency = 'INR',
      minConfidence = 0.3,
      inferMissingDates = true,
      maxDate = new Date(),
      minDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000),
      amountRange = { min: 0.01, max: 10000000 },
    } = options;

    // Step 1: Detect document type and issuer
    const detection = this.detectDocumentType(text);
    const issuer = detection.issuer || 'Unknown';

    // Step 2: Detect currency
    const currency = this.detectCurrency(text) || defaultCurrency;

    // Step 3: Determine date format preference based on issuer/currency
    const preferDDMM = this.isIndianStatement(detection.issuer, currency);
    const datePatterns = createLineDatePatterns(preferDDMM);

    // Step 4: Extract statement period
    const statementPeriod = this.extractStatementPeriod(text);

    // Step 5: Extract account number (last 4 only)
    const accountLast4 = this.extractAccountLast4(text);

    // Step 6: Parse transaction lines
    const lines = text.split('\n');
    const transactions: ParsedStatementTransaction[] = [];
    const warnings: string[] = [];
    let unparsedLineCount = 0;
    let lastValidDate: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) {
        continue;
      }

      // Skip known non-transaction lines
      if (this.shouldSkipLine(line)) {
        continue;
      }

      // Try to parse as a transaction line (with context-aware date patterns)
      const parsed = this.parseTransactionLine(line, {
        lastValidDate,
        inferMissingDates,
        maxDate,
        minDate,
        amountRange,
        datePatterns,
      });

      if (parsed) {
        // Auto-categorize the vendor (checks learned mappings first, then rules)
        const categorySuggestion = autoCategorizer.suggestCategory(
          parsed.vendor
        );

        // If the suggestion is from learned mappings, set category directly
        const learnedCategoryId =
          categorySuggestion?.isLearned && categorySuggestion.learnedCategoryId
            ? categorySuggestion.learnedCategoryId
            : null;

        const transaction: ParsedStatementTransaction = {
          id: `stmt-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          date: parsed.date,
          vendor: parsed.vendor,
          amount: parsed.amount,
          type: parsed.type,
          category: learnedCategoryId, // Set directly from learned mapping, or null for UI to resolve
          suggestedCategoryName: learnedCategoryId
            ? null // Already have a direct CategoryId, no name needed
            : categorySuggestion?.categoryName || null,
          rawLine: line,
          confidence: parsed.confidence,
          selected: true, // Selected by default
          note: '',
        };

        transactions.push(transaction);
        lastValidDate = parsed.date;
      } else {
        // Check if this line might be a continuation of the previous description
        if (transactions.length > 0 && this.isContinuationLine(line)) {
          const last = transactions[transactions.length - 1];
          if (last) {
            last.vendor += ` ${line.trim()}`;
            last.rawLine += `\n${line}`;
          }
        } else if (this.looksLikeTransactionData(line)) {
          unparsedLineCount++;
        }
      }
    }

    // Step 6: Filter by minimum confidence
    const filteredTransactions = transactions.filter(
      (t) => t.confidence >= minConfidence
    );

    // Step 7: Calculate totals
    const totals = this.calculateTotals(filteredTransactions);

    // Step 8: Try to extract statement total for validation
    const statementTotal = this.extractStatementTotal(text);
    totals.statementTotal = statementTotal;

    // Add validation warnings
    if (
      statementTotal !== null &&
      Math.abs(totals.netBalance - statementTotal) > 0.01
    ) {
      warnings.push(
        `Parsed total (${totals.netBalance.toFixed(2)}) differs from statement total (${statementTotal.toFixed(2)}). Please review.`
      );
    }

    if (unparsedLineCount > 0) {
      warnings.push(
        `${unparsedLineCount} line(s) could not be parsed and may contain transactions.`
      );
    }

    // Step 9: Calculate overall confidence
    const avgConfidence =
      filteredTransactions.length > 0
        ? filteredTransactions.reduce((sum, t) => sum + t.confidence, 0) /
          filteredTransactions.length
        : 0;

    const parsingTimeMs = performance.now() - startTime;

    return {
      documentType: detection.type,
      issuer,
      accountLast4,
      statementPeriod,
      transactions: filteredTransactions,
      totals,
      currency,
      confidence: avgConfidence,
      parsingTimeMs,
      unparsedLineCount,
      warnings,
    };
  }

  // ============================================
  // Private: Detection Helpers
  // ============================================

  /**
   * Detect the bank/card issuer from statement text.
   *
   * Phase 5: Prioritize header/metadata section to avoid false positives
   * from transaction descriptions. E.g., an ICICI statement might mention
   * "payment to OneCard" in a transaction, which would incorrectly detect
   * OneCard as the issuer if we scan the full text.
   *
   * Strategy:
   * 1. First scan only the header (~2000 chars) for issuer indicators
   * 2. If no match in header, scan the full text
   */
  private detectIssuer(text: string): string | null {
    // Step 1: Try header-only detection (first ~2000 chars or first 30 lines)
    const headerText = text.substring(0, 2000);
    for (const { pattern, name } of ISSUER_PATTERNS) {
      if (pattern.test(headerText)) {
        return name;
      }
    }

    // Step 2: Fall back to full-text detection
    for (const { pattern, name } of ISSUER_PATTERNS) {
      if (pattern.test(text)) {
        return name;
      }
    }

    return null;
  }

  /**
   * Detect currency from statement text.
   */
  private detectCurrency(text: string): string | null {
    // Check for explicit currency codes
    const codeMatch = text.match(
      /\b(USD|EUR|GBP|INR|CAD|AUD|JPY|CNY|CHF|SGD|HKD|NZD)\b/i
    );
    if (codeMatch) {
      return codeMatch[1]!.toUpperCase();
    }

    // Check for currency symbols (count occurrences)
    const symbolMap: Record<string, string> = {
      $: 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '₹': 'INR',
      '¥': 'JPY',
      '₩': 'KRW',
    };

    let maxCount = 0;
    let detectedCurrency: string | null = null;

    for (const [symbol, currency] of Object.entries(symbolMap)) {
      const regex = new RegExp(`\\${symbol}`, 'g');
      const matches = text.match(regex);
      const count = matches?.length ?? 0;
      if (count > maxCount) {
        maxCount = count;
        detectedCurrency = currency;
      }
    }

    // Check for Rs. / INR patterns (common in Indian statements)
    const rsCount = (text.match(/Rs\.?\s*\d/gi) || []).length;
    if (rsCount > maxCount) {
      detectedCurrency = 'INR';
    }

    return detectedCurrency;
  }

  /**
   * Extract statement period from text.
   */
  private extractStatementPeriod(text: string): {
    start: string | null;
    end: string | null;
  } {
    // Pattern: "Statement Period: Jan 01, 2026 - Jan 31, 2026"
    const periodPatterns = [
      /statement\s+period\s*:?\s*(.+?)\s*(?:to|-|through)\s*(.+?)(?:\n|$)/i,
      /billing\s+(?:period|cycle)\s*:?\s*(.+?)\s*(?:to|-|through)\s*(.+?)(?:\n|$)/i,
      /period\s*:?\s*(.+?)\s*(?:to|-|through)\s*(.+?)(?:\n|$)/i,
      /from\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+to\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    ];

    for (const pattern of periodPatterns) {
      const match = text.match(pattern);
      if (match) {
        const start = this.parseDateString(match[1]?.trim() ?? '');
        const end = this.parseDateString(match[2]?.trim() ?? '');
        if (start || end) {
          return { start, end };
        }
      }
    }

    return { start: null, end: null };
  }

  /**
   * Extract account number (last 4 digits only for privacy).
   */
  private extractAccountLast4(text: string): string | null {
    const patterns = [
      /(?:account|card|acct)[\s#:]*(?:no\.?\s*)?(?:\*{4,}|\d{4,}[\s*-]*)*(\d{4})/i,
      /(?:xxxx[\s-]*){1,3}(\d{4})/i,
      /\*{4,}\s*(\d{4})/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract statement total amount for validation.
   */
  private extractStatementTotal(text: string): number | null {
    const patterns = [
      /(?:total\s+(?:new\s+)?(?:charges|amount|debits|transactions))\s*:?\s*[\$€£₹]?\s*([\d,]+\.?\d*)/i,
      /(?:new\s+balance|closing\s+balance|amount\s+due)\s*:?\s*[\$€£₹]?\s*([\d,]+\.?\d*)/i,
      /(?:total\s+due)\s*:?\s*[\$€£₹]?\s*([\d,]+\.?\d*)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) {
          return amount;
        }
      }
    }

    return null;
  }

  // ============================================
  // Private: Line Parsing
  // ============================================

  /**
   * Check if a line should be skipped (headers, footers, noise, etc.).
   * Phase 1C/1D: Added line length limits and structural checks.
   */
  private shouldSkipLine(line: string): boolean {
    const trimmed = line.trim();

    // Too short to be a transaction
    if (trimmed.length < 5) {
      return true;
    }

    // Too long to be a single transaction line (likely a paragraph)
    if (trimmed.length > 300) {
      return true;
    }

    // Check against all skip patterns
    for (const pattern of SKIP_LINE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }

    // Skip lines that are purely numeric (page numbers, codes, etc.)
    if (/^\d+$/.test(trimmed)) {
      return true;
    }

    // Skip lines that look like phone numbers (10+ digit sequences)
    if (
      /(?:^|\s)[\+\-\(\)\d\s]{10,}(?:\s|$)/.test(trimmed) &&
      !/\.\d{2}/.test(trimmed)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if a line has a date pattern.
   */
  private lineHasDate(line: string): boolean {
    const trimmed = line.trim();
    for (const { regex } of LINE_DATE_PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(trimmed)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a line has an amount pattern.
   */
  private lineHasAmount(line: string): boolean {
    return /[\$€£₹]?\s*[\d,]+\.\d{2}\s*$/.test(line.trim());
  }

  /**
   * Check if a line looks like it might contain transaction data
   * (but couldn't be fully parsed).
   */
  private looksLikeTransactionData(line: string): boolean {
    const trimmed = line.trim();
    // Has a number that looks like an amount and some text
    return /\d+\.\d{2}/.test(trimmed) && trimmed.length > 15;
  }

  /**
   * Check if a line is likely a continuation of the previous line's description.
   */
  private isContinuationLine(line: string): boolean {
    const trimmed = line.trim();
    // No date at start, no amount at end, just text
    return (
      trimmed.length > 3 &&
      trimmed.length < 60 &&
      !this.lineHasDate(trimmed) &&
      !this.lineHasAmount(trimmed) &&
      !/^\d/.test(trimmed) &&
      !/[\$€£₹]/.test(trimmed)
    );
  }

  /**
   * Parse a single transaction line from a statement.
   */
  private parseTransactionLine(
    line: string,
    context: {
      lastValidDate: string | null;
      inferMissingDates: boolean;
      maxDate: Date;
      minDate: Date;
      amountRange: { min: number; max: number };
      datePatterns?: ReturnType<typeof createLineDatePatterns>;
    }
  ): {
    date: string;
    vendor: string;
    amount: number;
    type: ParsedStatementTransaction['type'];
    confidence: number;
  } | null {
    const trimmed = line.trim();
    const datePatterns = context.datePatterns || LINE_DATE_PATTERNS;

    // Step 1: Try to extract date from the beginning of the line
    let date: string | null = null;
    let remainingLine = trimmed;
    let dateConfidence = 0;

    for (const { regex, parser } of datePatterns) {
      regex.lastIndex = 0;
      const match = trimmed.match(regex);
      if (match) {
        const parsed = parser(match);
        if (parsed) {
          const normalized = this.normalizeDate(
            parsed.year,
            parsed.month,
            parsed.day
          );
          if (normalized) {
            const dateObj = new Date(normalized);
            if (dateObj <= context.maxDate && dateObj >= context.minDate) {
              date = normalized;
              remainingLine = trimmed.slice(match[0].length).trim();
              dateConfidence = 0.9;
              break;
            }
          }
        }
      }
    }

    // Some statements have a second date (posting date) right after transaction date
    // e.g., "01/15  01/17  STARBUCKS  $5.50"
    if (date) {
      for (const { regex } of datePatterns) {
        regex.lastIndex = 0;
        const secondDateMatch = remainingLine.match(regex);
        if (secondDateMatch && secondDateMatch.index === 0) {
          // Skip the posting date, keep the transaction date
          remainingLine = remainingLine.slice(secondDateMatch[0].length).trim();
          break;
        }
      }
    }

    // Step 2: Try to extract amount from the end of the line
    let amount: number | null = null;
    let isCredit = false;
    let amountConfidence = 0;

    for (const { regex, extractor } of LINE_AMOUNT_PATTERNS) {
      regex.lastIndex = 0;
      const match = remainingLine.match(regex);
      if (match) {
        const result = extractor(match);
        if (
          result.amount >= context.amountRange.min &&
          result.amount <= context.amountRange.max
        ) {
          amount = result.amount;
          isCredit = result.isCredit;
          remainingLine = remainingLine.slice(0, match.index).trim();
          amountConfidence = 0.85;
          break;
        }
      }
    }

    // If we don't have both a date and an amount, it's not a valid transaction line
    // (unless we can infer the date)
    if (amount === null) {
      return null;
    }

    if (date === null) {
      if (context.inferMissingDates && context.lastValidDate) {
        date = context.lastValidDate;
        dateConfidence = 0.5; // Lower confidence for inferred dates
      } else {
        return null;
      }
    }

    // Step 3: Extract vendor/description from the middle
    const vendor = this.cleanVendorDescription(remainingLine);
    if (!vendor || !this.isValidVendor(vendor)) {
      return null;
    }

    // Step 4: Determine transaction type
    const type = this.determineTransactionType(vendor, isCredit);

    // Adjust credit detection based on vendor keywords
    if (
      !isCredit &&
      CREDIT_KEYWORDS.some((kw) => vendor.toLowerCase().includes(kw))
    ) {
      isCredit = true;
    }

    // Step 5: Apply sign to amount
    // Positive = expense/debit, Negative = credit/payment/refund
    const signedAmount = isCredit ? -amount : amount;

    // Step 6: Calculate overall confidence
    const confidence =
      Math.round(((dateConfidence + amountConfidence) / 2) * 100) / 100;

    return {
      date,
      vendor,
      amount: signedAmount,
      type,
      confidence,
    };
  }

  /**
   * Determine the transaction type based on vendor text and credit flag.
   */
  private determineTransactionType(
    vendor: string,
    isCredit: boolean
  ): ParsedStatementTransaction['type'] {
    const lower = vendor.toLowerCase();

    if (/(?:payment|thank you|autopay)/.test(lower)) {
      return 'payment';
    }
    if (/(?:refund|return|reversal)/.test(lower)) {
      return 'refund';
    }
    if (/(?:interest|finance charge)/.test(lower)) {
      return 'interest';
    }
    if (/(?:fee|charge|penalty|annual fee|late fee)/.test(lower)) {
      return 'fee';
    }
    if (isCredit) {
      return 'credit';
    }
    return 'debit';
  }

  /**
   * Clean vendor/description text extracted from a statement line.
   * Phase 1D + Phase 5: Enhanced vendor cleaning for Indian bank UPI/ACH/NEFT formats.
   *
   * Handles ICICI, HDFC, SBI-style transaction descriptions like:
   *   UPI/merchant.vpa@bank/description/BANK NAME/txn_id/reference
   *   ACH/Indian Clearing Corp/account_ref/reference
   *   BIL/ONL/ref/BILL DESK/biller_id/reference
   *   NEFT/sender_name/ref/bank
   */
  private cleanVendorDescription(text: string): string {
    let cleaned = text.trim();

    // ---- Phase 5: Indian bank-specific format parsing ----
    // These run FIRST because they can extract clean vendor names from
    // structured formats (UPI/ACH/NEFT/BIL) before general cleaning.

    // UPI format: UPI/vpa@bank/description/BANK NAME/txnid/reference
    const upiMatch = cleaned.match(
      /^UPI\/([^/]+?)(?:@[^/]*)?\/(.*?)\/(?:[A-Z][A-Za-z\s]*(?:BANK|LTD|LIMITE|FIN)\b.*)/i
    );
    if (upiMatch) {
      const vpa = upiMatch[1] ?? '';
      const desc = upiMatch[2] ?? '';

      // Extract merchant name from VPA: "swiggy" from "swiggy@yespay"
      // or "tiasha.hore" from "tiasha.hore@okh"
      const merchant = vpa
        .replace(/@.*$/, '') // Remove @bank suffix
        .replace(/\.\w+$/, '') // Remove trailing .razorpay etc.
        .replace(/[._-]/g, ' ') // Convert separators to spaces
        .replace(/\d{5,}/g, '') // Remove long number sequences (phone numbers, IDs)
        .trim();

      // If description adds useful info (not just "NA", "UPI", "Sent using Payt", generic text)
      const isUsefulDesc =
        desc &&
        !/^(NA|UPI|Sent using Payt|Pay\s*via|topup|payment|express|Mandate)/i.test(
          desc
        );

      if (isUsefulDesc && desc.length > 2 && desc.length < 40) {
        // Use description if it's meaningful and short
        cleaned = desc;
      } else if (merchant.length >= 2) {
        cleaned = merchant;
      } else {
        cleaned = `${merchant} ${desc}`.trim();
      }
    }

    // ACH format: ACH/Indian Clearing Corp/account_ref/reference
    if (/^ACH\//i.test(cleaned)) {
      const achParts = cleaned.split('/');
      // The second part is usually the entity name
      const entity = achParts[1]?.trim() ?? '';
      cleaned = entity || 'ACH Payment';
    }

    // BIL/ONL format: BIL/ONL/ref/BILL DESK/biller_id/reference
    if (/^BIL\//i.test(cleaned)) {
      const bilParts = cleaned.split('/');
      // Look for a recognizable name in the parts
      const billerName = bilParts.find(
        (p) =>
          p &&
          p.length > 3 &&
          !/^\d+$/.test(p) &&
          !/^ONL$/i.test(p) &&
          !/^BILL\s*DESK$/i.test(p)
      );
      cleaned = billerName?.trim() || 'Bill Payment';
    }

    // NEFT format variant 1: NEFT/sender_name/ref/bank (slash-delimited)
    if (/^NEFT\//i.test(cleaned)) {
      const neftParts = cleaned.split('/');
      cleaned = neftParts[1]?.trim() || 'NEFT Transfer';
    }

    // NEFT format variant 2 (ICICI-style): NEFT-<bank_ref>-<COMPANY NAME><account_info>-<bank_code>
    // e.g., "NEFT-HDFCN52025013132332164-JIO PLATFORMS LIMITED840-0001-57500000439840-HDFC0000240"
    if (/^NEFT-/i.test(cleaned)) {
      const neftDashParts = cleaned.split('-');
      // Skip "NEFT" (index 0) and the bank reference (index 1)
      // Find the part that contains the company name (usually index 2+)
      // Company name is the part with alphabetic characters and spaces
      let companyName = '';
      for (let partIdx = 2; partIdx < neftDashParts.length; partIdx++) {
        const part = neftDashParts[partIdx]?.trim() ?? '';
        // Match parts that start with letters (company names), stop at pure-numeric parts
        if (/^[A-Z]/i.test(part)) {
          // Remove trailing account numbers/digits from the company name
          const cleanedPart = part.replace(/\d{3,}.*$/, '').trim();
          if (cleanedPart.length > 1) {
            companyName += (companyName ? ' ' : '') + cleanedPart;
          }
        } else if (companyName) {
          break; // Stop once we've passed the company name section
        }
      }
      cleaned = companyName || 'NEFT Transfer';
    }

    // IMPS format: IMPS/sender_name/ref
    if (/^IMPS\//i.test(cleaned)) {
      const impsParts = cleaned.split('/');
      cleaned = impsParts[1]?.trim() || 'IMPS Transfer';
    }

    // ---- General cleaning (runs on all vendors, including post-UPI extracted names) ----

    cleaned = cleaned
      .trim()
      // Remove reference/auth numbers at the end
      .replace(/\s+(?:REF|AUTH|CONF|TXN|ID|ARN|APPROVAL)[\s#:]*[\w-]+$/i, '')
      // Remove card last 4
      .replace(/\s+(?:XXXX|XX|Card)\s*\d{4}\s*/gi, '')
      // Remove city/state codes at end (e.g., "CHICAGO IL", "NEW YORK NY 10001")
      .replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/, '')
      // Remove Indian city suffixes often appended by card networks
      .replace(/\s+(?:IN|IND)\s*$/i, '')
      // Remove country codes (e.g., "US", "GB", "IN" at end)
      .replace(/\s+[A-Z]{2}\s*$/, '')
      // Remove trailing asterisks and hashes
      .replace(/[\s*#]+$/, '')
      // Remove remaining POS/ECOM/IMPS transaction type prefixes (if not already handled above)
      .replace(
        /^(?:POS|ECOM|IMPS|NEFT|RTGS|UPI|NACH|ECS|ACH|ATM)\s*[-/]?\s*/i,
        ''
      )
      // Remove UPI VPA patterns (e.g., "name@okaxis", "name@ybl")
      .replace(/\S+@\S+/gi, '')
      // Remove long alphanumeric reference strings (12+ chars of hex/mixed)
      .replace(/\b[A-Za-z0-9]{12,}\b/g, '')
      // Remove transaction IDs that look like numbers (9+ digits)
      .replace(/\b\d{9,}\b/g, '')
      // Remove bank names that are noise in vendor context
      .replace(
        /\b(?:YES\s*BANK|HDFC\s*BANK|ICICI\s*Bank|AXIS\s*BANK|SBI|FEDERAL\s*BANK|CANARA\s*BANK|UNION\s*BANK|IDBI\s*BANK|RBL\s*BANK)\b\.?\s*(?:LTD|LIMITE?D?)?\.?/gi,
        ''
      )
      // Remove standalone "LTD", "LIMITE", "BANK" fragments
      .replace(/\b(?:LTD|LIMITE|LIMITED|BANK)\b\.?\s*/gi, '')
      // Remove excessive whitespace
      .replace(/\s{2,}/g, ' ')
      // Remove leading/trailing special chars and slashes
      .replace(/^[*\-#/\s]+|[*\-#/\s]+$/g, '')
      .trim();

    // Title case if all uppercase (common in statements)
    if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
      cleaned = cleaned
        .toLowerCase()
        .replace(/(?:^|\s)\S/g, (match) => match.toUpperCase());
    }

    return cleaned;
  }

  /**
   * Validate that a parsed vendor name looks like a real vendor.
   * Phase 1D: Filters out garbage that slipped through as vendor text.
   */
  private isValidVendor(vendor: string): boolean {
    // Must have at least one alphabetic character
    if (!/[a-zA-Z]/.test(vendor)) {
      return false;
    }

    // Must not be too short (single char/digit combos)
    if (vendor.length < 2) {
      return false;
    }

    // Must not be purely a number with punctuation
    if (/^[\d\s.,\-\/]+$/.test(vendor)) {
      return false;
    }

    // Must not look like just a date
    if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(vendor)) {
      return false;
    }

    // Must not look like just a reference number
    if (/^(?:REF|AUTH|TXN|ARN|ID|NO|#)\s*:?\s*\w+$/i.test(vendor)) {
      return false;
    }

    return true;
  }

  /**
   * Parse a date string in various formats into ISO format.
   */
  private parseDateString(dateStr: string): string | null {
    // Try MM/DD/YYYY
    const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slashMatch) {
      let year = parseInt(slashMatch[3] ?? '0', 10);
      if (year < 100) {
        year = year > 50 ? 1900 + year : 2000 + year;
      }
      return this.normalizeDate(
        year,
        parseInt(slashMatch[1] ?? '0', 10),
        parseInt(slashMatch[2] ?? '0', 10)
      );
    }

    // Try "Month DD, YYYY" or "DD Month YYYY"
    const writtenMatch = dateStr.match(
      /(?:(\d{1,2})\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s*(\d{1,2})?,?\s*(\d{4})/i
    );
    if (writtenMatch) {
      const month = MONTH_MAP[writtenMatch[2]?.toLowerCase() ?? ''];
      if (month) {
        const day = parseInt(writtenMatch[1] || writtenMatch[3] || '1', 10);
        const year = parseInt(writtenMatch[4] ?? '0', 10);
        return this.normalizeDate(year, month, day);
      }
    }

    return null;
  }

  /**
   * Normalize date components to ISO string.
   */
  private normalizeDate(
    year: number,
    month: number,
    day: number
  ): string | null {
    if (year < 1900 || year > 2100) {
      return null;
    }
    if (month < 1 || month > 12) {
      return null;
    }
    if (day < 1 || day > 31) {
      return null;
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth) {
      return null;
    }

    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }

  /**
   * Calculate totals from parsed transactions.
   */
  private calculateTotals(
    transactions: ParsedStatementTransaction[]
  ): StatementParseResult['totals'] {
    let totalDebits = 0;
    let totalCredits = 0;

    for (const tx of transactions) {
      if (tx.amount >= 0) {
        totalDebits += tx.amount;
      } else {
        totalCredits += Math.abs(tx.amount);
      }
    }

    return {
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      // Net Balance = Credits - Debits (positive = net inflow, negative = net outflow)
      netBalance: Math.round((totalCredits - totalDebits) * 100) / 100,
      statementTotal: null,
    };
  }
}

// ============================================
// Singleton Export
// ============================================

/**
 * Singleton instance of the statement parser.
 */
export const statementParser = new StatementParserService();

/**
 * Convenience function to detect document type.
 */
export function detectDocumentType(text: string): DocumentTypeDetection {
  return statementParser.detectDocumentType(text);
}

/**
 * Convenience function to parse a statement.
 */
export function parseStatement(
  text: string,
  options?: StatementParserOptions
): StatementParseResult {
  return statementParser.parseStatement(text, options);
}
