/**
 * Statement processing types for SplitSync.
 *
 * Types for parsing bank and credit card statements into
 * individual transaction line items.
 *
 * PRIVACY: PDF/image extraction and regex parsing happen locally in the
 * browser. AI-assisted parsing sends masked statement text to the configured
 * server route, which calls Gemini. The import flow exposes a local-only mode
 * when the user does not want AI parsing.
 */

import type { ExpenseCategorySlug } from "@/lib/expense-categories";

// ============================================
// Document Type Detection
// ============================================

/**
 * The detected type of an uploaded document.
 */
export type DocumentType = 'receipt' | 'statement' | 'invoice' | 'unknown';

/**
 * Result of document type detection.
 */
export interface DocumentTypeDetection {
  /** Detected document type */
  type: DocumentType;

  /** Confidence in the detection (0-1) */
  confidence: number;

  /** Keywords that triggered the detection */
  matchedKeywords: string[];

  /** Detected issuer (bank, card company, etc.) */
  issuer: string | null;
}

// ============================================
// Statement Transaction (Parsed Line Item)
// ============================================

/**
 * A single transaction parsed from a statement.
 */
export interface ParsedStatementTransaction {
  /** Unique ID for this line item (generated during parsing) */
  id: string;

  /** Transaction date in ISO 8601 format (YYYY-MM-DD) */
  date: string;

  /** Vendor/merchant/description from the statement line */
  vendor: string;

  /** Transaction amount (positive = debit/expense, negative = credit/payment) */
  amount: number;

  /** Transaction type */
  type: 'debit' | 'credit' | 'payment' | 'fee' | 'interest' | 'refund';

  /** Auto-assigned category slug. */
  category: ExpenseCategorySlug | null;

  /** Suggested category name (before mapping to CategoryId) */
  suggestedCategoryName: string | null;

  /** Raw line text from the statement */
  rawLine: string;

  /** Confidence in the parsing of this line (0-1) */
  confidence: number;

  /** Whether the user has selected this transaction for import */
  selected: boolean;

  /** User-editable note */
  note: string;
}

// ============================================
// Statement Parse Result
// ============================================

/**
 * Complete result of parsing a financial statement.
 */
export interface StatementParseResult {
  /** Detected document type */
  documentType: DocumentType;

  /** Bank/card company name */
  issuer: string;

  /** Account number (last 4 digits only, for display) */
  accountLast4: string | null;

  /** Statement period */
  statementPeriod: {
    start: string | null;
    end: string | null;
  };

  /** Individual parsed transactions */
  transactions: ParsedStatementTransaction[];

  /** Statement-level totals for validation */
  totals: {
    /** Total debits/charges */
    totalDebits: number;
    /** Total credits/payments */
    totalCredits: number;
    /** Net balance (debits - credits) */
    netBalance: number;
    /** Statement total if detected from the document */
    statementTotal: number | null;
  };

  /** Detected currency */
  currency: string;

  /** Overall parsing confidence (0-1) */
  confidence: number;

  /** Parsing time in milliseconds */
  parsingTimeMs: number;

  /** Number of lines that could not be parsed */
  unparsedLineCount: number;

  /** Warnings generated during parsing */
  warnings: string[];
}

// ============================================
// Statement Parser Options
// ============================================

/**
 * Options for the statement parser.
 */
export interface StatementParserOptions {
  /** Default currency if not detected */
  defaultCurrency?: string;

  /** Minimum confidence to include a transaction */
  minConfidence?: number;

  /** Whether to attempt date inference for lines missing dates */
  inferMissingDates?: boolean;

  /** Maximum date (default: today) - used for validation */
  maxDate?: Date;

  /** Minimum date (default: 2 years ago) - used for validation */
  minDate?: Date;

  /** Amount range for sanity checks */
  amountRange?: {
    min: number;
    max: number;
  };
}
