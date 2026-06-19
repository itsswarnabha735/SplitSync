/**
 * Statement Text Pre-processor for Vault-AI
 *
 * Cleans and normalizes raw PDF-extracted statement text before it is
 * sent to either the regex parser or the LLM parser. The goal is to:
 *
 * 1. Strip page noise (headers, footers, branch addresses, repeated
 *    column headers, customer name on every page, page numbers)
 * 2. Join multi-line transactions into single lines so that each
 *    transaction has its date, description, and amounts on one line
 * 3. Skip non-transaction lines (B/F balances, separator lines)
 * 4. Preserve metadata at the top of the statement (issuer, period, etc.)
 *
 * This dramatically improves parsing accuracy for multi-page Indian
 * bank statements (ICICI, HDFC, SBI, etc.) where PDF.js text extraction
 * produces messy multi-line output with repeated page chrome.
 *
 * PRIVACY: All processing happens locally in the browser.
 */

// ============================================
// Constants
// ============================================

/**
 * Patterns for lines that are definitely page noise and should be stripped.
 * These are checked AFTER the repeated-line detection pass.
 */
const PAGE_NOISE_PATTERNS: RegExp[] = [
  // Page numbers
  /^Page\s+\d+\s+of\s*\d+\s*$/i,
  /^\s*\d+\s+of\s+\d+\s*$/i,
  /^--\s*\d+\s+of\s+\d+\s*--\s*$/,

  // Bank website / phone
  /^Visit\s+www\./i,
  /^Dial\s+your\s+Bank/i,
  /^(?:www\.|https?:\/\/)/i,

  // Branch address lines
  /^Your\s+(?:Base\s+)?Branch\s*:/i,

  // Bank name headers (standalone, repeated on every page)
  /^(?:ICICI|HDFC|SBI|Axis|Kotak|Yes|IndusInd|RBL|IDFC|Federal)\s+BANK\s+LTD\.?,/i,

  // Column headers for Indian bank statements
  /^\s*DATE\s+MODE\s*\*{0,2}\s+PARTICULARS\s+/i,
  /^\s*DATE\s+PARTICULARS\s+(?:DEPOSITS?|WITHDRAWALS?|BALANCE)/i,
  /^\s*(?:SR\.?\s*NO\.?\s+)?DATE\s+(?:DESCRIPTION|PARTICULARS|TRANSACTION)/i,
  /^\s*(?:DATE|DESCRIPTION|PARTICULARS)\s+(?:DEPOSITS?|WITHDRAWALS?|CREDITS?|DEBITS?|BALANCE)\s/i,

  // Statement summary / account summary headers (not transaction data)
  /^ACCOUNT\s+DETAILS\s*[-–]?\s*INR$/i,
  /^ACCOUNT\s+TYPE\s+A\/c\s+BALANCE/i,
  /^Summary\s+of\s+Accounts?\s+held/i,

  // Disclaimers and KYC reminders
  /^Did\s+you\s+know\?/i,
  /^KYC\s+/i,
  /^\s*\*{2}\s*Mode\s+of\s+transaction/i,
  /^\s*\*{2}\s*Legend/i,

  // Purely reference/code lines (long hex or alphanumeric strings)
  /^[A-Za-z0-9]{30,}$/,

  // Separator lines
  /^[-=_*]{5,}$/,
  /^[.\s]{10,}$/,

  // Empty or whitespace-only
  /^\s*$/,
];

/**
 * Patterns for lines that are B/F (Brought Forward) balance lines.
 * These should be skipped as they are not actual transactions.
 */
const BALANCE_FORWARD_PATTERNS: RegExp[] = [
  /\bB\s*\/\s*F\b/i,
  /\bBrought?\s+Forward\b/i,
  /\bC\s*\/\s*F\b/i, // Carried Forward
  /\bCarried?\s+Forward\b/i,
  /\bOpening\s+Balance\b/i,
  /\bClosing\s+Balance\b/i,
];

/**
 * Date pattern to detect the start of a transaction line.
 * Matches DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, DD Mon YYYY, etc.
 */
const TRANSACTION_DATE_PATTERN =
  /^(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{2,4})/i;

/**
 * Pattern to detect an amount at the end of a line.
 * Matches Indian lakh notation (1,23,456.78) and standard (1,234.56).
 */
const LINE_ENDING_AMOUNT_PATTERN = /[\d,]+\.\d{2}\s*$/;

// ============================================
// Pre-processor
// ============================================

/**
 * Pre-process raw statement text for better parsing accuracy.
 *
 * @param text - Raw text extracted from a PDF by PDF.js
 * @returns Cleaned text with multi-line transactions joined into single lines
 */
export function preprocessStatementText(text: string): string {
  const rawLines = text.split('\n');

  // Step 1: Detect repeated lines (page headers/footers that appear on every page)
  const repeatedLines = detectRepeatedLines(rawLines);

  // Step 2: Strip page noise and repeated lines
  const cleanedLines = stripPageNoise(rawLines, repeatedLines);

  // Step 3: Detect if this is a statement that needs multi-line joining
  // (i.e., has date lines without amounts and separate amount lines)
  const needsJoining = detectMultiLineFormat(cleanedLines);

  // Step 4: Join multi-line transactions if needed
  const processedLines = needsJoining
    ? joinMultiLineTransactions(cleanedLines)
    : cleanedLines;

  return processedLines.join('\n');
}

/**
 * Detect lines that are repeated many times (likely page headers/footers).
 * Uses a frequency threshold: any line appearing on 3+ "pages" is noise.
 */
function detectRepeatedLines(lines: string[]): Set<string> {
  const lineFrequency = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    // Only consider non-trivial lines (3-120 chars) that aren't dates or amounts
    if (
      trimmed.length >= 3 &&
      trimmed.length <= 120 &&
      !TRANSACTION_DATE_PATTERN.test(trimmed) &&
      !/^[\d,]+\.\d{2}/.test(trimmed)
    ) {
      lineFrequency.set(trimmed, (lineFrequency.get(trimmed) || 0) + 1);
    }
  }

  const repeatedLines = new Set<string>();
  for (const [line, count] of lineFrequency) {
    if (count >= 3) {
      repeatedLines.add(line);
    }
  }

  return repeatedLines;
}

/**
 * Strip page noise: page headers/footers, repeated lines, known noise patterns.
 * Preserves the first occurrence of metadata lines (issuer info, statement period, etc.).
 */
function stripPageNoise(lines: string[], repeatedLines: Set<string>): string[] {
  // Track which repeated lines we've seen before. Keep the first occurrence
  // (might be metadata), strip subsequent ones.
  const seenRepeated = new Set<string>();

  const result: string[] = [];
  let metadataEndIndex = -1;

  // Find where metadata ends (first transaction date or column header)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? '';
    if (
      TRANSACTION_DATE_PATTERN.test(trimmed) ||
      /^\s*DATE\s+/i.test(trimmed)
    ) {
      metadataEndIndex = i;
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Always keep empty lines within the first metadata block
    if (i < metadataEndIndex && trimmed.length === 0) {
      continue;
    }

    // Skip lines matching known noise patterns
    if (PAGE_NOISE_PATTERNS.some((p) => p.test(trimmed))) {
      continue;
    }

    // Handle repeated lines
    if (repeatedLines.has(trimmed)) {
      if (seenRepeated.has(trimmed)) {
        // Already seen this repeated line before — skip it
        continue;
      }
      // First occurrence — keep it if it's in the metadata section
      if (i < metadataEndIndex) {
        seenRepeated.add(trimmed);
        result.push(trimmed);
      } else {
        seenRepeated.add(trimmed);
        // Skip repeated lines outside metadata section
        continue;
      }
      continue;
    }

    // Skip B/F (Brought Forward) lines
    if (BALANCE_FORWARD_PATTERNS.some((p) => p.test(trimmed))) {
      continue;
    }

    // Keep everything else
    result.push(trimmed);
  }

  return result;
}

/**
 * Detect whether the statement text has a multi-line transaction format.
 *
 * Multi-line format indicators:
 * - Date lines that DON'T end with an amount
 * - Amount lines that DON'T start with a date
 * - Ratio of date-only lines to date+amount lines is high
 */
function detectMultiLineFormat(lines: string[]): boolean {
  let dateOnlyLines = 0;
  let dateWithAmountLines = 0;
  let amountOnlyLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const hasDate = TRANSACTION_DATE_PATTERN.test(trimmed);
    const hasAmount = LINE_ENDING_AMOUNT_PATTERN.test(trimmed);

    if (hasDate && !hasAmount) {
      dateOnlyLines++;
    }
    if (hasDate && hasAmount) {
      dateWithAmountLines++;
    }
    if (!hasDate && hasAmount) {
      amountOnlyLines++;
    }
  }

  // If there are significantly more date-only lines than date+amount lines,
  // it's a multi-line format (like ICICI)
  if (dateOnlyLines > 5 && dateOnlyLines > dateWithAmountLines * 1.5) {
    return true;
  }

  // If there are many amount-only lines (amounts on continuation lines)
  if (amountOnlyLines > 5 && amountOnlyLines > dateWithAmountLines) {
    return true;
  }

  return false;
}

/**
 * Join multi-line transactions into single lines.
 *
 * Algorithm:
 * 1. Scan lines looking for "transaction start" (a line starting with a date)
 * 2. Accumulate continuation lines until the next transaction start
 * 3. A continuation line is anything that doesn't start with a date
 * 4. Join the block into a single line
 *
 * This handles formats like ICICI where each transaction spans 3-5 lines:
 *   01-01-2025
 *   UPI/VIACOM18ONLINE@/Subscription De/YES
 *   BANK
 *   LIMITE/500160069328/YBL2d191546ac9b4e8e8387
 *   2b8b9bc83087
 *                                           29.00 3,73,088.44
 *
 * Becomes:
 *   01-01-2025 UPI/VIACOM18ONLINE@... 29.00 3,73,088.44
 */
function joinMultiLineTransactions(lines: string[]): string[] {
  const result: string[] = [];
  let currentBlock: string[] = [];
  let inTransactions = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const startsWithDate = TRANSACTION_DATE_PATTERN.test(trimmed);

    if (startsWithDate) {
      // If we have a pending block, flush it
      if (currentBlock.length > 0) {
        result.push(joinBlock(currentBlock));
      }
      // Start a new transaction block
      currentBlock = [trimmed];
      inTransactions = true;
    } else if (inTransactions) {
      // Continuation of current transaction
      currentBlock.push(trimmed);
    } else {
      // Before any transactions (metadata section) — keep as-is
      result.push(trimmed);
    }
  }

  // Flush the last block
  if (currentBlock.length > 0) {
    result.push(joinBlock(currentBlock));
  }

  return result;
}

/**
 * Join a block of lines into a single transaction line.
 * Preserves meaningful whitespace between tokens.
 */
function joinBlock(block: string[]): string {
  return block.map((l) => l.trim()).join(' ');
}

/**
 * Estimate the number of transactions in the statement text.
 * Counts lines that start with a date pattern.
 */
export function estimateTransactionCount(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (TRANSACTION_DATE_PATTERN.test(line.trim())) {
      count++;
    }
  }
  return count;
}
