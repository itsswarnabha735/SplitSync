/**
 * LLM-Enhanced Statement Parser (Client-Side)
 *
 * Implements an LLM-FIRST architecture for statement parsing:
 * 1. LLM parser runs first (higher accuracy, especially for Indian statements)
 * 2. If LLM fails, regex parser is used as fallback
 * 3. Results are validated and merged with regex metadata
 *
 * TIERED MODEL STRATEGY (Phase 2D):
 * - Primary call: gemini-2.0-flash-lite (cheap, fast)
 * - If primary returns too few transactions: retry with gemini-2.5-flash (smarter)
 * - If both LLM calls fail: fall back to regex parser
 *
 * PRIVACY: Statement text contains only structured financial data
 * (dates, vendor names, amounts) which are all SYNCABLE_FIELDS.
 * Account numbers are masked server-side before sending to the LLM.
 */

import type {
  ParsedStatementTransaction,
  StatementParseResult,
} from './types';
import { autoCategorizer } from './auto-categorizer';
import {
  preprocessStatementText,
  estimateTransactionCount,
} from './statement-preprocessor';

// ============================================
// Types
// ============================================

/**
 * Response from the parse-statement API route.
 */
interface LLMParseAPIResponse {
  success: boolean;
  data?: {
    issuer: string | null;
    accountLast4: string | null;
    currency: string;
    statementPeriod: { start: string; end: string } | null;
    transactions: Array<{
      date: string;
      vendor: string;
      amount: number;
      type: 'debit' | 'credit' | 'payment' | 'fee' | 'interest' | 'refund';
      category?: string;
    }>;
    totals: {
      debits: number;
      credits: number;
      payments: number;
      fees: number;
    };
  };
  error?: string;
  meta?: {
    transactionCount: number;
    model: string;
    tier: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
}

/**
 * Options for LLM statement parsing.
 */
export interface LLMStatementParserOptions {
  /** Minimum confidence from regex parser to skip LLM fallback (legacy, still respected) */
  minRegexConfidence?: number;

  /** Minimum transaction count from regex parser to skip LLM fallback (legacy) */
  minRegexTransactions?: number;

  /** Force LLM parsing regardless of regex results */
  forceLLM?: boolean;

  /** Minimum transactions expected before triggering retry with smarter model */
  minExpectedTransactions?: number;

  /** Skip LLM entirely and use only regex (e.g., when offline) */
  regexOnly?: boolean;
}

const DEFAULT_OPTIONS: Required<LLMStatementParserOptions> = {
  minRegexConfidence: 0.5,
  minRegexTransactions: 3,
  forceLLM: false,
  minExpectedTransactions: 3,
  regexOnly: false,
};

// ============================================
// LLM Statement Parser Service
// ============================================

class LLMStatementParserService {
  /**
   * In-flight request deduplication cache.
   * Maps a hash of (text + modelTier) to the pending promise.
   * Prevents duplicate API calls when the same text is submitted concurrently.
   */
  private pendingRequests = new Map<
    string,
    Promise<StatementParseResult | null>
  >();

  /**
   * Simple hash for deduplication key (first 200 chars + length + tier).
   */
  private makeRequestKey(text: string, modelTier: string): string {
    return `${text.substring(0, 200)}|${text.length}|${modelTier}`;
  }

  /**
   * Determine if LLM fallback should be triggered based on regex parser results.
   * In the new LLM-first architecture, this is used as a "should we skip LLM" check.
   */
  shouldUseLLMFallback(
    regexResult: StatementParseResult,
    options: LLMStatementParserOptions = {}
  ): boolean {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (opts.regexOnly) {
      return false;
    }
    if (opts.forceLLM) {
      return true;
    }

    // Low confidence from regex parser
    if (regexResult.confidence < opts.minRegexConfidence) {
      return true;
    }

    // Too few transactions extracted
    if (regexResult.transactions.length < opts.minRegexTransactions) {
      return true;
    }

    // High unparsed line count relative to parsed transactions
    if (
      regexResult.unparsedLineCount > 0 &&
      regexResult.unparsedLineCount > regexResult.transactions.length * 2
    ) {
      return true;
    }

    return false;
  }

  /**
   * Parse a statement using the LLM API route.
   *
   * @param text - The statement text
   * @param issuerHint - Optional issuer hint from regex detection
   * @param currencyHint - Optional currency hint from regex detection
   * @param modelTier - Which model tier to use ('primary' or 'retry')
   * @returns A StatementParseResult, or null if the API call fails
   */
  async parseWithLLM(
    text: string,
    issuerHint?: string,
    currencyHint?: string,
    modelTier: 'primary' | 'retry' | 'large' = 'primary'
  ): Promise<StatementParseResult | null> {
    // Deduplicate concurrent calls with the same text + tier
    const requestKey = this.makeRequestKey(text, modelTier);
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      console.log(`[LLM Parser] Deduplicating request (tier: ${modelTier})`);
      return pending;
    }

    const promise = this._parseWithLLMImpl(
      text,
      issuerHint,
      currencyHint,
      modelTier
    );
    this.pendingRequests.set(requestKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(requestKey);
    }
  }

  /**
   * Internal implementation of parseWithLLM (called once per unique request).
   */
  private async _parseWithLLMImpl(
    text: string,
    issuerHint?: string,
    currencyHint?: string,
    modelTier: 'primary' | 'retry' | 'large' = 'primary'
  ): Promise<StatementParseResult | null> {
    const startTime = performance.now();

    try {
      const response = await fetch('/api/parse-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statementText: text,
          issuerHint,
          currencyHint,
          modelTier,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn(
          `[LLM Parser] API call failed (tier: ${modelTier}):`,
          response.status,
          (errorData as Record<string, string>)?.error
        );
        return null;
      }

      const result: LLMParseAPIResponse = await response.json();

      if (!result.success || !result.data) {
        console.warn('[LLM Parser] API returned failure:', result.error);
        return null;
      }

      // Convert LLM response to StatementParseResult format
      // IMPORTANT: The LLM returns all amounts as positive numbers and uses
      // the `type` field to distinguish debit from credit. We must apply the
      // sign convention here: credit/payment/refund/interest → negative amount.
      // This matches the local regex parser (statement-parser.ts) which does
      // `isCredit ? -amount : amount` at line 1354.
      const CREDIT_TYPES = new Set(['credit', 'payment', 'refund', 'interest']);

      const transactions: ParsedStatementTransaction[] =
        result.data.transactions.map((tx, index) => {
          // Always try auto-categorize: checks learned mappings first, then rules.
          // Even if LLM suggested a category, learned user mappings take priority.
          const suggestion = autoCategorizer.suggestCategory(tx.vendor);

          // Priority: learned mapping > LLM category > auto-categorizer rule
          const learnedCategoryId =
            suggestion?.isLearned && suggestion.learnedCategoryId
              ? suggestion.learnedCategoryId
              : null;

          // Apply sign: credits are negative, debits/fees are positive
          const signedAmount = CREDIT_TYPES.has(tx.type)
            ? -Math.abs(tx.amount)
            : Math.abs(tx.amount);

          return {
            id: `llm-${Date.now()}-${index}`,
            date: tx.date,
            vendor: tx.vendor,
            amount: signedAmount,
            type: tx.type,
            category: learnedCategoryId, // Direct from learned mapping, or null
            suggestedCategoryName: learnedCategoryId
              ? null // Already resolved via learned mapping
              : tx.category || suggestion?.categoryName || null,
            rawLine: `[LLM-${index + 1}] ${tx.date} ${tx.vendor} ${tx.amount}`,
            confidence: 0.88, // LLM-parsed lines get a fixed high confidence
            selected: true,
            note: '',
          };
        });

      const parsingTimeMs = performance.now() - startTime;

      // Calculate totals from parsed transactions (amounts are now signed)
      const totalDebits = transactions
        .filter((t) => t.type === 'debit' || t.type === 'fee')
        .reduce((sum, t) => sum + t.amount, 0);
      const totalCredits = transactions
        .filter((t) => CREDIT_TYPES.has(t.type))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const parseResult: StatementParseResult = {
        documentType: 'statement',
        issuer: result.data.issuer || 'Unknown',
        accountLast4: result.data.accountLast4,
        statementPeriod: result.data.statementPeriod
          ? {
              start: result.data.statementPeriod.start,
              end: result.data.statementPeriod.end,
            }
          : { start: null, end: null },
        transactions,
        totals: {
          totalDebits,
          totalCredits,
          netBalance: totalCredits - totalDebits,
          statementTotal: null,
        },
        currency: result.data.currency,
        confidence: 0.88,
        parsingTimeMs,
        unparsedLineCount: 0,
        warnings: [`Parsed using AI (${result.meta?.model || 'Gemini'})`],
      };

      console.log(
        `[LLM Parser] Successfully parsed ${transactions.length} transactions in ${parsingTimeMs.toFixed(0)}ms`,
        `(model: ${result.meta?.model}, tier: ${result.meta?.tier})`,
        result.meta?.usage ? `(tokens: ${result.meta.usage.totalTokens})` : ''
      );

      return parseResult;
    } catch (error) {
      console.error(`[LLM Parser] Failed (tier: ${modelTier}):`, error);
      return null;
    }
  }

  /**
   * LLM-First parsing with tiered retry and regex fallback.
   *
   * Strategy (Phase 2C + 2D + Phase 5: large statement support):
   * 1. Pre-process statement text (strip noise, join multi-line transactions)
   * 2. Estimate statement size and select appropriate model tier
   * 3. For small statements: flash-lite primary → 2.5-flash retry
   * 4. For large statements (50+ transactions): skip flash-lite, use 2.5-flash directly
   * 5. For very large statements (500+ transactions): use chunked processing
   * 6. If all LLM calls fail, fall back to regex
   * 7. Merge metadata from regex, validate results
   */
  async parseWithLLMFirst(
    text: string,
    regexResult: StatementParseResult,
    options: LLMStatementParserOptions = {}
  ): Promise<StatementParseResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // If regex-only mode, skip LLM entirely
    if (opts.regexOnly) {
      return regexResult;
    }

    // NOTE: Callers should pre-process text via preprocessStatementText() before calling this method.
    // If text has already been preprocessed, this is the identity function (idempotent).
    // We run it here as a safety net for direct callers.
    const preprocessedText = preprocessStatementText(text);

    console.log(
      `[LLM Parser] LLM-first parsing (regex found: ${regexResult.transactions.length} txns, confidence: ${regexResult.confidence.toFixed(2)})`,
      `(input text: ${text.length} chars, preprocessed: ${preprocessedText.length} chars)`
    );

    // Step 2: Estimate transaction count to select optimal model tier
    const estimatedTxns = Math.max(
      regexResult.transactions.length,
      estimateTransactionCount(preprocessedText)
    );

    const isLargeStatement = estimatedTxns >= 50;
    const isVeryLargeStatement = estimatedTxns >= 500;

    console.log(
      `[LLM Parser] Estimated transactions: ${estimatedTxns}`,
      `(large: ${isLargeStatement}, very large: ${isVeryLargeStatement})`
    );

    // Step 3: For very large statements, use chunked processing with flash-lite
    if (isVeryLargeStatement) {
      console.log(
        '[LLM Parser] Very large statement detected. Using chunked processing with flash-lite...'
      );
      const chunkedResult = await this.parseWithChunks(
        preprocessedText,
        regexResult
      );
      if (chunkedResult) {
        return this.postProcessResult(chunkedResult, regexResult);
      }
      // If chunked processing failed entirely, fall through to regex fallback.
      // Don't try a single-pass 2.5-flash call on the full text — if chunks failed,
      // a single large request will almost certainly fail/timeout too.
      console.log(
        '[LLM Parser] Chunked processing failed. Falling back to regex.'
      );
      return {
        ...regexResult,
        warnings: [
          ...regexResult.warnings,
          'AI chunked parsing failed. Using pattern-matching results only.',
        ],
      };
    }

    // Step 4: Select model tier based on statement size
    let llmResult: StatementParseResult | null = null;

    if (isLargeStatement) {
      // Large statements (50-500 txns): use 2.5-flash (with thinking disabled for speed)
      console.log(
        '[LLM Parser] Large statement — using gemini-2.5-flash directly...'
      );
      llmResult = await this.parseWithLLM(
        preprocessedText,
        regexResult.issuer || undefined,
        regexResult.currency,
        'large'
      );
    } else {
      // Small statements: try flash-lite first (cheap & fast)
      llmResult = await this.parseWithLLM(
        preprocessedText,
        regexResult.issuer || undefined,
        regexResult.currency,
        'primary'
      );

      // If primary returned too few transactions, retry with smarter model
      if (
        llmResult &&
        llmResult.transactions.length < opts.minExpectedTransactions &&
        regexResult.transactions.length >= opts.minExpectedTransactions
      ) {
        console.log(
          `[LLM Parser] Primary model returned only ${llmResult.transactions.length} txns ` +
            `(expected >= ${opts.minExpectedTransactions}). Retrying with smarter model...`
        );

        const retryResult = await this.parseWithLLM(
          preprocessedText,
          regexResult.issuer || undefined,
          regexResult.currency,
          'retry'
        );

        if (
          retryResult &&
          retryResult.transactions.length > llmResult.transactions.length
        ) {
          llmResult = retryResult;
          llmResult.warnings.push(
            'Upgraded to smarter AI model for better accuracy'
          );
        }
      }
    }

    // Step 5: If primary/large failed entirely, try retry model once
    if (!llmResult) {
      console.log(
        '[LLM Parser] Primary/large model failed. Trying retry model...'
      );
      llmResult = await this.parseWithLLM(
        preprocessedText,
        regexResult.issuer || undefined,
        regexResult.currency,
        'retry'
      );
    }

    // Step 6: If all LLM calls failed, fall back to regex
    if (!llmResult) {
      console.log('[LLM Parser] All LLM calls failed. Using regex fallback.');
      return {
        ...regexResult,
        warnings: [
          ...regexResult.warnings,
          'AI parsing failed. Using pattern-matching results only.',
        ],
      };
    }

    // Step 7: Post-process and validate
    const validated = this.postProcessResult(llmResult, regexResult);

    return validated;
  }

  /**
   * Parse a very large statement by splitting it into chunks.
   *
   * Each chunk is processed independently with the LLM, then results
   * are merged. This handles statements with 500+ transactions where
   * even gemini-2.5-flash's 65K output tokens might not be enough.
   *
   * Chunking strategy: split by date-line boundaries to avoid cutting
   * a transaction in the middle.
   */
  private async parseWithChunks(
    preprocessedText: string,
    regexResult: StatementParseResult
  ): Promise<StatementParseResult | null> {
    const lines = preprocessedText.split('\n');

    // Find the metadata section (before first transaction date)
    const datePattern = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;
    let metadataEndIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (datePattern.test(lines[i]?.trim() ?? '')) {
        metadataEndIndex = i;
        break;
      }
    }

    const metadataLines = lines.slice(0, metadataEndIndex);
    const transactionLines = lines.slice(metadataEndIndex);

    // Split transaction lines into chunks of ~50 transactions each.
    // Smaller chunks = faster per-chunk processing, and each chunk
    // fits within flash-lite's 8192 output token limit (~50 txns × ~120 chars ≈ 6K chars ≈ 1.5K tokens).
    const CHUNK_SIZE = 50;
    const chunks: string[][] = [];
    let currentChunk: string[] = [];
    let txnCount = 0;

    for (const line of transactionLines) {
      if (datePattern.test(line.trim())) {
        txnCount++;
        if (txnCount > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [];
          txnCount = 1;
        }
      }
      currentChunk.push(line);
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    console.log(
      `[LLM Parser] Split into ${chunks.length} chunks (~${CHUNK_SIZE} txns each)`
    );

    // Process each chunk sequentially using the fast primary model (flash-lite).
    // Each chunk is small enough to fit within flash-lite's 8192 output token limit.
    const allTransactions: ParsedStatementTransaction[] = [];
    const allWarnings: string[] = [];
    let issuer = regexResult.issuer;
    let accountLast4 = regexResult.accountLast4;
    let currency = regexResult.currency;
    let statementPeriod = regexResult.statementPeriod;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = [...metadataLines, ...chunks[i]!].join('\n');

      console.log(
        `[LLM Parser] Processing chunk ${i + 1}/${chunks.length} (${chunkText.length} chars)`
      );

      // Use primary (flash-lite) for chunks — it's much faster and doesn't need thinking.
      // Each chunk is small enough (~50 txns) to fit within flash-lite's output limits.
      const chunkResult = await this.parseWithLLM(
        chunkText,
        regexResult.issuer || undefined,
        regexResult.currency,
        'primary'
      );

      if (chunkResult) {
        allTransactions.push(...chunkResult.transactions);
        allWarnings.push(...chunkResult.warnings);
        consecutiveFailures = 0; // Reset on success

        // Take metadata from the first successful chunk
        if (i === 0) {
          issuer = chunkResult.issuer || issuer;
          accountLast4 = chunkResult.accountLast4 || accountLast4;
          currency = chunkResult.currency || currency;
          statementPeriod = chunkResult.statementPeriod || statementPeriod;
        }
      } else {
        consecutiveFailures++;
        allWarnings.push(
          `Chunk ${i + 1} failed to parse — some transactions may be missing.`
        );

        // If too many consecutive failures, the API is likely down — bail out early
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(
            `[LLM Parser] ${MAX_CONSECUTIVE_FAILURES} consecutive chunk failures — aborting chunked processing.`
          );
          allWarnings.push(
            `Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive API failures. ` +
              `${chunks.length - i - 1} chunk(s) skipped.`
          );
          break;
        }
      }
    }

    if (allTransactions.length === 0) {
      return null;
    }

    // Deduplicate transactions (chunks might have slight overlap)
    const deduped = this.deduplicateTransactions(allTransactions);

    // Calculate totals (amounts are signed: credits negative, debits positive)
    const CREDIT_TYPES = new Set(['credit', 'payment', 'refund', 'interest']);
    const totalDebits = deduped
      .filter((t) => t.type === 'debit' || t.type === 'fee')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalCredits = deduped
      .filter((t) => CREDIT_TYPES.has(t.type))
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return {
      documentType: 'statement',
      issuer: issuer || 'Unknown',
      accountLast4,
      statementPeriod,
      transactions: deduped,
      totals: {
        totalDebits: Math.round(totalDebits * 100) / 100,
        totalCredits: Math.round(totalCredits * 100) / 100,
        netBalance: Math.round((totalCredits - totalDebits) * 100) / 100,
        statementTotal: null,
      },
      currency,
      confidence: 0.88,
      parsingTimeMs: 0, // Will be overwritten
      unparsedLineCount: 0,
      warnings: [
        `Parsed using chunked AI processing (${chunks.length} chunks)`,
        ...allWarnings,
      ],
    };
  }

  /**
   * Deduplicate transactions by (date, vendor, amount).
   * Used after chunked processing where chunks may overlap slightly.
   */
  private deduplicateTransactions(
    transactions: ParsedStatementTransaction[]
  ): ParsedStatementTransaction[] {
    const seen = new Set<string>();
    const result: ParsedStatementTransaction[] = [];

    for (const tx of transactions) {
      const key = `${tx.date}|${tx.vendor}|${tx.amount}|${tx.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(tx);
      }
    }

    return result;
  }

  /**
   * Legacy method: Try LLM parsing and merge with regex results.
   * Now delegates to parseWithLLMFirst.
   */
  async parseWithFallback(
    text: string,
    regexResult: StatementParseResult,
    options: LLMStatementParserOptions = {}
  ): Promise<StatementParseResult> {
    // Check if LLM fallback is needed (legacy behavior for backward compat)
    if (!this.shouldUseLLMFallback(regexResult, options)) {
      return regexResult;
    }

    // Delegate to LLM-first flow
    return this.parseWithLLMFirst(text, regexResult, options);
  }

  /**
   * Post-process LLM results: validate, merge metadata from regex.
   * Phase 3: Validates amounts, dates, and cross-references with regex.
   */
  private postProcessResult(
    llmResult: StatementParseResult,
    regexResult: StatementParseResult
  ): StatementParseResult {
    // Merge metadata: prefer regex-detected issuer over LLM's.
    // The regex parser uses header-first scanning (first 2000 chars) to avoid
    // false positives from transaction descriptions. LLMs often get confused by
    // bank names in NEFT/RTGS references (e.g., "NEFT-HDFCN..." in an ICICI statement).
    const merged: StatementParseResult = {
      ...llmResult,
      issuer:
        regexResult.issuer && regexResult.issuer !== 'Unknown'
          ? regexResult.issuer
          : llmResult.issuer || regexResult.issuer,
      accountLast4: llmResult.accountLast4 || regexResult.accountLast4,
      statementPeriod: this.bestStatementPeriod(
        llmResult.statementPeriod,
        regexResult.statementPeriod
      ),
      currency: llmResult.currency || regexResult.currency,
    };

    // Phase 3A: Filter out amount outliers
    const filteredTransactions = this.filterAmountOutliers(merged.transactions);
    if (filteredTransactions.length < merged.transactions.length) {
      const removed = merged.transactions.length - filteredTransactions.length;
      merged.transactions = filteredTransactions;
      merged.warnings.push(
        `${removed} suspicious transaction(s) removed by validation.`
      );
    }

    // Phase 3B: Validate dates are within statement period
    if (merged.statementPeriod.start && merged.statementPeriod.end) {
      const dateFlagged = this.flagOutOfPeriodDates(
        merged.transactions,
        merged.statementPeriod.start,
        merged.statementPeriod.end
      );
      if (dateFlagged > 0) {
        merged.warnings.push(
          `${dateFlagged} transaction(s) have dates outside the statement period. Please review.`
        );
      }
    }

    // Phase 3C: Cross-validate totals with regex-detected statement total
    if (regexResult.totals.statementTotal !== null) {
      merged.totals.statementTotal = regexResult.totals.statementTotal;
      const llmTotal = merged.totals.totalDebits;
      const diff = Math.abs(llmTotal - regexResult.totals.statementTotal);
      if (diff > 1 && diff / regexResult.totals.statementTotal > 0.05) {
        merged.warnings.push(
          `Parsed debit total (${llmTotal.toFixed(2)}) differs from statement total ` +
            `(${regexResult.totals.statementTotal.toFixed(2)}) by ${diff.toFixed(2)}. Please verify.`
        );
      }
    }

    // Add regex transaction count comparison
    if (regexResult.transactions.length > 0) {
      merged.warnings.push(
        `AI found ${merged.transactions.length} transactions vs ${regexResult.transactions.length} from pattern matching.`
      );
    }

    // Recalculate totals after filtering
    // Amounts are signed: debits positive, credits negative
    // Debits: debit + fee (money out)
    // Credits: credit + payment + refund + interest (money in)
    const totalDebits = merged.transactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const totalCredits = merged.transactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    merged.totals.totalDebits = Math.round(totalDebits * 100) / 100;
    merged.totals.totalCredits = Math.round(totalCredits * 100) / 100;
    // Net Balance = Credits - Debits (positive = net inflow, negative = net outflow)
    merged.totals.netBalance =
      Math.round((totalCredits - totalDebits) * 100) / 100;

    return merged;
  }

  /**
   * Phase 3A: Filter out amount outliers.
   * Detects transactions whose amounts are implausibly large relative to
   * other transactions — typically a running balance or total that was
   * accidentally parsed as a transaction amount.
   *
   * IMPORTANT: Credit-type transactions (salary, refunds, incoming transfers)
   * are exempt from outlier filtering. Salary credits in Indian savings
   * accounts are often 100-300x larger than typical UPI micro-purchases
   * but are completely legitimate.
   *
   * For debits, uses a 500x-median threshold with a minimum floor of
   * ₹5,00,000 (5 lakh) to avoid filtering large but legitimate expenses.
   */
  private filterAmountOutliers(
    transactions: ParsedStatementTransaction[]
  ): ParsedStatementTransaction[] {
    if (transactions.length < 5) {
      return transactions;
    } // Too few to detect outliers

    // Only consider debit-type transactions for outlier detection
    const debitAmounts = transactions
      .filter((t) => t.type === 'debit' || t.type === 'fee')
      .map((t) => Math.abs(t.amount))
      .sort((a, b) => a - b);

    if (debitAmounts.length < 3) {
      return transactions;
    } // Too few debits to detect outliers

    const median = debitAmounts[Math.floor(debitAmounts.length / 2)] || 0;
    if (median === 0) {
      return transactions;
    }

    // Use 500x median with a minimum floor of 5,00,000 (5 lakh / ~$6,000)
    // This prevents filtering legitimate large expenses like rent, car payments, etc.
    const ABSOLUTE_MIN_THRESHOLD = 500000;
    const threshold = Math.max(median * 500, ABSOLUTE_MIN_THRESHOLD);

    return transactions.filter((t) => {
      // Never filter credit-type transactions (salary, refunds, transfers in)
      // These are often legitimately much larger than typical debits.
      if (['credit', 'payment', 'refund', 'interest'].includes(t.type)) {
        return true;
      }

      const amt = Math.abs(t.amount);
      if (amt > threshold) {
        console.warn(
          `[LLM Parser] Filtering outlier: ${t.vendor} ${t.amount} (median: ${median.toFixed(2)}, threshold: ${threshold.toFixed(2)})`
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Phase 3B: Flag transactions with dates outside statement period.
   * Doesn't remove them (dates could be pre-auth), just lowers confidence.
   */
  private flagOutOfPeriodDates(
    transactions: ParsedStatementTransaction[],
    periodStart: string,
    periodEnd: string
  ): number {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Allow 7-day buffer (pre-auth, posting delay)
    start.setDate(start.getDate() - 7);
    end.setDate(end.getDate() + 7);

    let flagged = 0;
    for (const tx of transactions) {
      const txDate = new Date(tx.date);
      if (txDate < start || txDate > end) {
        tx.confidence = Math.max(0.3, tx.confidence - 0.3);
        flagged++;
      }
    }
    return flagged;
  }

  /**
   * Pick the best statement period from two sources.
   */
  private bestStatementPeriod(
    a: { start: string | null; end: string | null },
    b: { start: string | null; end: string | null }
  ): { start: string | null; end: string | null } {
    const aHasBoth = a.start && a.end;
    const bHasBoth = b.start && b.end;

    if (aHasBoth) {
      return a;
    }
    if (bHasBoth) {
      return b;
    }

    return {
      start: a.start || b.start,
      end: a.end || b.end,
    };
  }
}

// ============================================
// Singleton Export
// ============================================

/**
 * Singleton instance of the LLM statement parser.
 */
export const llmStatementParser = new LLMStatementParserService();
