/**
 * API Route: LLM-Enhanced Statement Parser
 *
 * Server-side endpoint that uses Google Gemini to parse financial
 * statement text into structured transactions. This is the PRIMARY
 * parsing mechanism (LLM-first architecture) with regex as fallback.
 *
 * PRIVACY NOTE:
 * Financial statement text contains only structured financial data
 * (dates, vendor names, amounts, account numbers) which are all
 * within the SYNCABLE_FIELDS whitelist. No raw document images or
 * embeddings are transmitted. Account numbers are masked before
 * being sent to the LLM (only last 4 digits preserved).
 *
 * MODEL TIERS (Phase 2D):
 * - Primary: gemini-2.0-flash-lite (ultra low cost, fast)
 * - Retry:   gemini-2.5-flash (smarter, for complex statements)
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildLLMCategoryBlock } from '@/lib/expense-categories';

// ============================================
// Types
// ============================================

interface LLMParsedTransaction {
  date: string;
  vendor: string;
  amount: number;
  type: 'debit' | 'credit' | 'payment' | 'fee' | 'interest' | 'refund';
  category?: string;
}

interface LLMParseResponse {
  issuer: string | null;
  accountLast4: string | null;
  currency: string;
  statementPeriod: { start: string; end: string } | null;
  transactions: LLMParsedTransaction[];
  totals: {
    debits: number;
    credits: number;
    payments: number;
    fees: number;
  };
}

interface ParseStatementRequest {
  /** The statement text to parse (privacy-safe: only dates/vendors/amounts) */
  statementText: string;

  /** Optional hint about the issuer */
  issuerHint?: string;

  /** Optional hint about the currency */
  currencyHint?: string;

  /** Which model tier to use: 'primary' (flash-lite), 'retry' (2.5-flash), or 'large' (2.5-flash high output) */
  modelTier?: 'primary' | 'retry' | 'large';
}

// ============================================
// Model Configuration (Phase 2D)
// ============================================

const MODEL_TIERS = {
  primary: {
    model: 'gemini-2.0-flash-lite',
    maxOutputTokens: 8192,
    temperature: 0.05, // Very low for structured extraction
    timeoutMs: 90_000,
    disableThinking: false, // flash-lite doesn't have thinking
  },
  retry: {
    model: 'gemini-2.5-flash',
    maxOutputTokens: 65536,
    temperature: 0.1,
    timeoutMs: 180_000, // 3 min — 2.5-flash can take longer with large output
    disableThinking: true, // Disable thinking for structured extraction (faster)
  },
  large: {
    model: 'gemini-2.5-flash',
    maxOutputTokens: 65536,
    temperature: 0.05,
    timeoutMs: 180_000,
    disableThinking: true, // Disable thinking for structured extraction (faster)
  },
} as const;

// ============================================
// Helpers
// ============================================

/**
 * Mask sensitive account numbers, keeping only last 4 digits.
 */
function maskAccountNumbers(text: string): string {
  // Mask full account/card numbers (12-19 digits)
  return text.replace(
    /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{1,3})?)\b/g,
    (match) => {
      const digits = match.replace(/[\s-]/g, '');
      if (digits.length >= 12) {
        return `****${digits.slice(-4)}`;
      }
      return match;
    }
  );
}

/**
 * Truncate statement text if too long to keep within token limits.
 *
 * Gemini Flash models support 1M+ input tokens (~750K chars), so we use
 * a generous default of 200K chars. For pre-processed text (page noise
 * stripped, multi-line transactions joined), even large year-long
 * statements typically fit well within this limit.
 *
 * If truncation is necessary, we keep the header (metadata), a large
 * middle section (transactions), and the footer (summaries/totals).
 */
function truncateStatementText(
  text: string,
  maxChars: number = 200000
): string {
  if (text.length <= maxChars) {
    return text;
  }

  // Keep first 10% (header/metadata), middle 80% (transactions), last 10% (summary)
  const headerChars = Math.floor(maxChars * 0.1);
  const bodyChars = Math.floor(maxChars * 0.8);
  const footerChars = Math.floor(maxChars * 0.1);

  const header = text.slice(0, headerChars);
  const middle = text.slice(headerChars, headerChars + bodyChars);
  const footer = text.slice(-footerChars);

  return `${header}\n...[truncated: some transactions may be missing]...\n${middle}\n...[truncated]...\n${footer}`;
}

/**
 * Build the prompt for Gemini to parse the statement.
 * Phase 2B: Rewritten with Indian context, ignore rules, and structured examples.
 */
function buildStatementParsingPrompt(
  text: string,
  issuerHint?: string,
  currencyHint?: string
): string {
  return `You are an expert financial document parser specializing in Indian and international bank/credit card statements. Extract ALL individual transactions from the following statement text. This may be a long, multi-page statement — you MUST extract EVERY transaction, do not stop early.

${issuerHint ? `Issuer hint: ${issuerHint}` : ''}
${currencyHint ? `Currency hint: ${currencyHint}` : ''}

CRITICAL RULES:
1. Extract ONLY actual transaction line items (purchases, payments, fees, refunds, interest charges).
2. DO NOT extract these as transactions — IGNORE them completely:
   - Summary lines (Total, Subtotal, Grand Total, Opening/Closing Balance, New Balance, Amount Due)
   - Headers (Date, Description, Amount, Debit, Credit, Balance, Particulars)
   - B/F (Brought Forward) or C/F (Carried Forward) balance lines
   - Reward/loyalty points lines
   - EMI conversion offers
   - Contact information (phone, email, address)
   - Legal disclaimers, Terms & Conditions
   - Tax breakdowns (GST, CGST, SGST) — these are sub-items, not transactions
   - Statement metadata (account number, statement period, credit limit, etc.)
   - Page numbers, separator lines
   - Marketing/promotional text
3. Transaction types: "debit" (purchase/withdrawal/charge), "credit" (money received/deposited/refund credited), "payment" (payment made by cardholder), "fee" (bank fee/charge/late fee/annual fee), "interest" (interest/finance charge), "refund" (returned amount)
4. Amounts MUST always be positive numbers. Use the "type" field to distinguish debit from credit.
5. Dates MUST be in YYYY-MM-DD format. If only day and month are visible, infer the year from the statement period or header.
6. IMPORTANT — Indian bank saving account statements:
   - Dates are DD/MM/YYYY or DD-MM-YYYY format (e.g., 01-01-2025 = January 1, 2025)
   - Columns are typically: DATE | PARTICULARS | DEPOSITS | WITHDRAWALS | BALANCE
   - Each transaction line may end with TWO amounts: the transaction amount AND the running balance
   - The LAST number on the line is always the running BALANCE — IGNORE it, do NOT use it as the transaction amount
   - The number BEFORE the balance is the actual transaction amount (deposit or withdrawal)
   - To determine if a transaction is a deposit (credit) or withdrawal (debit):
     * If the balance INCREASED compared to the previous line → it is a DEPOSIT (type: "credit")
     * If the balance DECREASED compared to the previous line → it is a WITHDRAWAL (type: "debit")
     * UPI payments, purchases, bill payments = withdrawals (debit)
     * Salary credits, refunds, incoming transfers = deposits (credit)
   - Amounts may use Indian numbering: 1,23,456.78 (lakh notation)
   - Currency is INR (₹ or Rs.)
   - ACH/Indian Clearing Corp entries are typically recurring payments/SIPs (debit)
   - NEFT transactions (salary credits, inter-bank transfers):
     * Format: "NEFT-<reference>-<COMPANY NAME><account_info>-<bank_code>"
     * These are almost always CREDITS (incoming money) — salary, vendor payments, refunds
     * Extract the company/sender name from the description (e.g., "JIO PLATFORMS LIMITED" from "NEFT-HDFCN5...-JIO PLATFORMS LIMITED840-...")
     * Salary credits should be type "credit" with category "Income"
   - RTGS transactions follow a similar pattern to NEFT but for larger amounts
   - Common prefixes to REMOVE from vendor names: POS, ECOM, IMPS, NEFT, UPI, NACH, ATM, ACH, BIL/ONL
   - UPI IDs (e.g., name@okaxis, name@ybl) should be removed from vendor names
   - Reference numbers, transaction IDs, long alphanumeric codes should be removed from vendor names
   - For UPI transactions like "UPI/merchant@bank/description/BANK NAME/txnid", extract just the merchant name
7. Clean up vendor names: remove transaction codes, reference numbers, city/country suffixes, card numbers (XXXX1234), but keep the merchant name recognizable. Make vendor names human-readable (e.g., "VIACOM18ONLINE" → "Viacom18 Online", "cred.club" → "CRED", "groww.razorpay" → "Groww").
8. You MUST assign a category for EVERY transaction. Use your best judgment based on the vendor name.
   ${buildLLMCategoryBlock()}

EXAMPLE INPUT (Indian bank savings account with balance column):
  01-01-2025 UPI/swiggy@yespay/In App/YesBank/501086441240/YJPb1e9... 318.00 1,04,462.04
EXAMPLE OUTPUT (318.00 is the withdrawal, 1,04,462.04 is the balance — ignore balance):
  {"date": "2025-01-01", "vendor": "Swiggy", "amount": 318.00, "type": "debit", "category": "Food & Dining"}

EXAMPLE INPUT:
  05-01-2025 UPI/tiasha.hore@okh/UPI/HDFC BANK LTD/500599413416/HDFaef69... 10,000.00 1,13,889.76
EXAMPLE OUTPUT (balance went UP by 10000, so this is a deposit/credit):
  {"date": "2025-01-05", "vendor": "Tiasha Hore", "amount": 10000.00, "type": "credit", "category": "Transfers"}

EXAMPLE INPUT:
  14-01-2025 UPI/groww.rzp@axisb/PayviaRazorpay/AXIS BANK/538002468478/ICI36d509... 8,000.00 76,843.04
EXAMPLE OUTPUT:
  {"date": "2025-01-14", "vendor": "Groww", "amount": 8000.00, "type": "debit", "category": "Investments"}

EXAMPLE INPUT (NEFT salary credit — balance jumps from 9,136.90 to 1,96,687.90):
  31-01-2025 NEFT-HDFCN52025013132332164-JIO PLATFORMS LIMITED840-0001-57500000439840-HDFC0000240 1,87,551.00 1,96,687.90
EXAMPLE OUTPUT (1,87,551.00 is the salary deposit, 1,96,687.90 is the new balance — ignore balance):
  {"date": "2025-01-31", "vendor": "Jio Platforms Limited", "amount": 187551.00, "type": "credit", "category": "Income"}

EXAMPLE INPUT (NEFT/RTGS incoming transfer):
  28-02-2025 NEFT-SBIN0000001-SOME COMPANY NAME-REF12345 50,000.00 2,50,000.00
EXAMPLE OUTPUT:
  {"date": "2025-02-28", "vendor": "Some Company Name", "amount": 50000.00, "type": "credit", "category": "Income"}

Return ONLY valid JSON in this exact format (no markdown, no explanation, no code fences):
{
  "issuer": "Bank/Card issuer name or null",
  "accountLast4": "1234 or null",
  "currency": "INR",
  "statementPeriod": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"},
  "transactions": [
    {"date": "YYYY-MM-DD", "vendor": "Merchant Name", "amount": 42.99, "type": "debit", "category": "Shopping"}
  ],
  "totals": {"debits": 0.00, "credits": 0.00, "payments": 0.00, "fees": 0.00}
}

STATEMENT TEXT:
${text}`;
}

// ============================================
// Route Handler
// ============================================

export async function POST(request: NextRequest) {
  try {
    // 1. Validate API key is configured
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 503 }
      );
    }

    // 2. Parse request body
    const body: ParseStatementRequest = await request.json();

    if (!body.statementText || body.statementText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Statement text is too short to parse' },
        { status: 400 }
      );
    }

    // 3. Privacy: mask account numbers before sending to LLM
    let safeText = maskAccountNumbers(body.statementText);

    // 4. Truncate if needed to stay within token limits
    safeText = truncateStatementText(safeText);

    // 5. Build the prompt
    const prompt = buildStatementParsingPrompt(
      safeText,
      body.issuerHint,
      body.currencyHint
    );

    // 6. Select model tier (Phase 2D + Phase 5: large statement support)
    const tier = body.modelTier || 'primary';
    const modelConfig = MODEL_TIERS[tier] || MODEL_TIERS.primary;

    // 7. Build Gemini API request body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generationConfig: Record<string, any> = {
      temperature: modelConfig.temperature,
      topP: 0.8,
      maxOutputTokens: modelConfig.maxOutputTokens,
      responseMimeType: 'application/json',
    };

    // Disable thinking for gemini-2.5-flash to reduce latency on extraction tasks.
    // Thinking adds significant latency (can push past 90s timeout) and doesn't
    // improve accuracy for structured data extraction.
    if (modelConfig.disableThinking) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    // 8. Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_NONE',
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE',
            },
          ],
        }),
        signal: AbortSignal.timeout(modelConfig.timeoutMs),
      }
    );

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json().catch(() => ({}));
      console.error(
        '[parse-statement] Gemini API error:',
        geminiResponse.status,
        errorData
      );
      return NextResponse.json(
        {
          error: `Gemini API error: ${geminiResponse.status}`,
          details:
            (errorData as Record<string, unknown>)?.error || 'Unknown error',
        },
        { status: 502 }
      );
    }

    const geminiData = await geminiResponse.json();

    // 8. Extract the text response
    const responseText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!responseText) {
      return NextResponse.json(
        { error: 'Empty response from Gemini API' },
        { status: 502 }
      );
    }

    // 9. Parse the JSON response
    let parsedResult: LLMParseResponse;
    try {
      // Strip markdown code fences if present (some models still add them)
      const cleanedText = responseText
        .replace(/^```(?:json)?\s*\n?/gm, '')
        .replace(/\n?```\s*$/gm, '')
        .trim();

      parsedResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        '[parse-statement] Failed to parse LLM JSON:',
        parseError,
        'Raw text:',
        responseText.substring(0, 500)
      );
      return NextResponse.json(
        { error: 'Failed to parse LLM response as JSON' },
        { status: 502 }
      );
    }

    // 10. Validate the parsed result
    if (
      !parsedResult.transactions ||
      !Array.isArray(parsedResult.transactions)
    ) {
      return NextResponse.json(
        { error: 'LLM response missing transactions array' },
        { status: 502 }
      );
    }

    // 11. Sanitize and validate individual transactions
    const validTransactions = parsedResult.transactions
      .filter(
        (tx) =>
          tx.date && tx.vendor && typeof tx.amount === 'number' && tx.amount > 0
      )
      .map((tx) => ({
        date: normalizeDate(String(tx.date)),
        vendor: String(tx.vendor).trim(),
        amount: Math.abs(Number(tx.amount)),
        type: ([
          'debit',
          'credit',
          'payment',
          'fee',
          'interest',
          'refund',
        ].includes(tx.type)
          ? tx.type
          : 'debit') as LLMParsedTransaction['type'],
        category: tx.category ? String(tx.category) : undefined,
      }))
      // Phase 3: Filter out transactions with invalid dates
      .filter((tx) => tx.date !== 'Invalid');

    // 12. Return the result
    const result: LLMParseResponse = {
      issuer: parsedResult.issuer || null,
      accountLast4: parsedResult.accountLast4 || null,
      currency: parsedResult.currency || body.currencyHint || 'INR',
      statementPeriod: parsedResult.statementPeriod || null,
      transactions: validTransactions,
      totals: parsedResult.totals || {
        debits: 0,
        credits: 0,
        payments: 0,
        fees: 0,
      },
    };

    // Include token usage metadata for monitoring
    const usage = geminiData?.usageMetadata;

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        transactionCount: validTransactions.length,
        model: modelConfig.model,
        tier,
        usage: usage
          ? {
              promptTokens: usage.promptTokenCount || 0,
              completionTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
            }
          : undefined,
      },
    });
  } catch (error) {
    console.error('[parse-statement] Unexpected error:', error);

    // Handle both AbortError (older Node.js) and TimeoutError (Node 18+)
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      return NextResponse.json(
        { error: 'Request timed out — Gemini API did not respond in time' },
        { status: 504 }
      );
    }

    // Handle DOMException (some environments wrap timeout as DOMException)
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Request timed out — Gemini API did not respond in time' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Normalize a date string to YYYY-MM-DD format.
 * Handles various formats the LLM might return.
 */
function normalizeDate(dateStr: string): string {
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1]!.padStart(2, '0');
    const month = ddmmyyyy[2]!.padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }

  // MM/DD/YYYY (if month > 12, it must be DD/MM)
  const mmddyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mmddyyyy) {
    const first = parseInt(mmddyyyy[1]!, 10);
    const second = parseInt(mmddyyyy[2]!, 10);
    if (first > 12) {
      // Must be DD/MM
      return `${mmddyyyy[3]}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
    }
  }

  return 'Invalid';
}
