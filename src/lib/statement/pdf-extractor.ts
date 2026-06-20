/**
 * PDF Text Extraction Service for Vault-AI
 *
 * Uses PDF.js to extract text from PDF documents.
 * Detects image-based PDFs that require OCR.
 *
 * PRIVACY: All PDF processing happens locally in the browser.
 * No document content is ever transmitted to external servers.
 */

// ============================================
// Types
// ============================================

/**
 * Result of PDF text extraction.
 */
export interface PDFExtractionResult {
  /** Extracted text content */
  text: string;

  /** Number of pages in the PDF */
  pageCount: number;

  /** Whether the PDF appears to be image-based (needs OCR) */
  isImageBased: boolean;

  /** Text extracted per page */
  pageTexts: string[];

  /** PDF metadata if available */
  metadata: PDFMetadata | null;

  /** Extraction time in milliseconds */
  extractionTimeMs: number;
}

/**
 * PDF metadata extracted from the document.
 */
export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

/**
 * Progress callback for multi-page PDFs.
 */
export interface PDFProgressCallback {
  (progress: PDFProgress): void;
}

/**
 * Progress information during PDF extraction.
 */
export interface PDFProgress {
  currentPage: number;
  totalPages: number;
  percentComplete: number;
}

/**
 * Options for PDF extraction.
 */
export interface PDFExtractionOptions {
  /** Progress callback for multi-page documents */
  onProgress?: PDFProgressCallback;

  /** Minimum text length per page to consider it text-based (not image) */
  minTextLengthPerPage?: number;

  /** Maximum pages to process (0 = all) */
  maxPages?: number;
}

// ============================================
// PDF.js Types
// ============================================

interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  getMetadata(): Promise<{ info: Record<string, unknown> }>;
  destroy(): Promise<void>;
}

interface PDFPageProxy {
  getTextContent(): Promise<TextContent>;
  getViewport(options: { scale: number }): PDFViewport;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PDFViewport;
  }): { promise: Promise<void> };
}

interface TextContent {
  items: TextItem[];
}

interface TextItem {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
}

interface PDFViewport {
  width: number;
  height: number;
}

interface GetDocumentResult {
  promise: Promise<PDFDocumentProxy>;
}

// ============================================
// Constants
// ============================================

/**
 * Minimum characters per page to consider it text-based.
 * PDFs with less text than this are likely image-based.
 */
const DEFAULT_MIN_TEXT_LENGTH = 50;

/**
 * PDF.js worker source path.
 */
const PDF_WORKER_SRC = '/pdf.worker.min.mjs';

// ============================================
// PDFExtractor Class
// ============================================

/**
 * PDF text extraction service using PDF.js.
 */
class PDFExtractorService {
  private pdfjs: any = null;
  private isInitialized = false;

  /**
   * Initialize PDF.js library.
   *
   * Uses native browser import (webpackIgnore) to bypass webpack bundling.
   * pdfjs-dist v5 is ESM-only and breaks under webpack's module wrapper
   * (Object.defineProperty called on non-object). Loading from /public
   * with a native import avoids this entirely.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Native browser import — bypasses webpack bundling entirely.
    // The pdf.min.mjs file is served from /public.
    // @ts-expect-error - runtime path served from public/, not a TS module
    this.pdfjs = await import(/* webpackIgnore: true */ '/pdf.min.mjs');

    // Set worker source
    if (typeof window !== 'undefined') {
      this.pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }

    this.isInitialized = true;
  }

  getPdfJsForRendering() {
    if (!this.pdfjs) {
      throw new PDFExtractionError('PDF.js not initialized');
    }
    return this.pdfjs;
  }

  /**
   * Extract text from a PDF file.
   */
  async extractText(
    file: File | ArrayBuffer,
    options: PDFExtractionOptions = {}
  ): Promise<PDFExtractionResult> {
    const startTime = performance.now();

    await this.initialize();

    if (!this.pdfjs) {
      throw new PDFExtractionError('PDF.js not initialized');
    }

    const {
      onProgress,
      minTextLengthPerPage = DEFAULT_MIN_TEXT_LENGTH,
      maxPages = 0,
    } = options;

    // Get array buffer from file
    const arrayBuffer =
      file instanceof ArrayBuffer ? file : await file.arrayBuffer();

    // Load the PDF document
    const loadingTask = this.pdfjs.getDocument({
      data: arrayBuffer,
    }) as unknown as GetDocumentResult;

    const pdfDoc = await loadingTask.promise;

    try {
      const totalPages = pdfDoc.numPages;
      const pagesToProcess =
        maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;

      const pageTexts: string[] = [];
      let fullText = '';
      let lowTextPageCount = 0;

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items preserving line structure
        const pageText = textContent.items
          .map((item: TextItem, idx: number, arr: TextItem[]) => {
            let text = item.str;
            if (item.hasEOL) {
              text += '\n';
            } else if (idx < arr.length - 1) {
              const next = arr[idx + 1];
              // Check if next item is on a different Y position (new line)
              if (
                next &&
                item.transform &&
                next.transform &&
                Math.abs((item.transform[5] ?? 0) - (next.transform[5] ?? 0)) >
                  2
              ) {
                text += '\n';
              } else {
                text += ' ';
              }
            }
            return text;
          })
          .join('')
          .trim();

        pageTexts.push(pageText);
        fullText += (pageNum > 1 ? '\n\n' : '') + pageText;

        // Check if this page has enough text
        if (pageText.length < minTextLengthPerPage) {
          lowTextPageCount++;
        }

        // Report progress
        if (onProgress) {
          onProgress({
            currentPage: pageNum,
            totalPages: pagesToProcess,
            percentComplete: Math.round((pageNum / pagesToProcess) * 100),
          });
        }
      }

      // Determine if PDF is image-based
      // If more than half the pages have low text, it's likely image-based
      const isImageBased = lowTextPageCount > pagesToProcess / 2;

      // Extract metadata
      const metadata = await this.extractMetadata(pdfDoc);

      return {
        text: fullText,
        pageCount: totalPages,
        isImageBased,
        pageTexts,
        metadata,
        extractionTimeMs: performance.now() - startTime,
      };
    } finally {
      // Clean up
      await pdfDoc.destroy();
    }
  }

  /**
   * Extract metadata from a PDF document.
   */
  private async extractMetadata(
    pdfDoc: PDFDocumentProxy
  ): Promise<PDFMetadata | null> {
    try {
      const { info } = await pdfDoc.getMetadata();

      if (!info) {
        return null;
      }

      return {
        title: info.Title as string | undefined,
        author: info.Author as string | undefined,
        subject: info.Subject as string | undefined,
        keywords: info.Keywords as string | undefined,
        creator: info.Creator as string | undefined,
        producer: info.Producer as string | undefined,
        creationDate: this.parseDate(info.CreationDate as string | undefined),
        modificationDate: this.parseDate(info.ModDate as string | undefined),
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse PDF date string to Date object.
   * PDF dates are in format: D:YYYYMMDDHHmmSSOHH'mm'
   */
  private parseDate(dateStr: string | undefined): Date | undefined {
    if (!dateStr) {
      return undefined;
    }

    try {
      // Remove 'D:' prefix if present
      const cleaned = dateStr.replace(/^D:/, '');

      // Extract components
      const year = parseInt(cleaned.slice(0, 4), 10);
      const month = parseInt(cleaned.slice(4, 6) || '01', 10) - 1;
      const day = parseInt(cleaned.slice(6, 8) || '01', 10);
      const hour = parseInt(cleaned.slice(8, 10) || '00', 10);
      const minute = parseInt(cleaned.slice(10, 12) || '00', 10);
      const second = parseInt(cleaned.slice(12, 14) || '00', 10);

      return new Date(year, month, day, hour, minute, second);
    } catch {
      return undefined;
    }
  }

  /**
   * Get page count without extracting full text.
   */
  async getPageCount(file: File | ArrayBuffer): Promise<number> {
    await this.initialize();

    if (!this.pdfjs) {
      throw new PDFExtractionError('PDF.js not initialized');
    }

    const arrayBuffer =
      file instanceof ArrayBuffer ? file : await file.arrayBuffer();

    const loadingTask = this.pdfjs.getDocument({
      data: arrayBuffer,
    }) as unknown as GetDocumentResult;

    const pdfDoc = await loadingTask.promise;

    try {
      return pdfDoc.numPages;
    } finally {
      await pdfDoc.destroy();
    }
  }

  /**
   * Render a PDF page to an image for OCR or thumbnails.
   */
  async renderPageToImage(
    file: File | ArrayBuffer,
    pageNumber: number = 1,
    scale: number = 2.0
  ): Promise<ImageData> {
    await this.initialize();

    if (!this.pdfjs) {
      throw new PDFExtractionError('PDF.js not initialized');
    }

    const arrayBuffer =
      file instanceof ArrayBuffer ? file : await file.arrayBuffer();

    const loadingTask = this.pdfjs.getDocument({
      data: arrayBuffer,
    }) as unknown as GetDocumentResult;

    const pdfDoc = await loadingTask.promise;

    try {
      if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
        throw new PDFExtractionError(
          `Invalid page number: ${pageNumber}. PDF has ${pdfDoc.numPages} pages.`
        );
      }

      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        throw new PDFExtractionError('Failed to get canvas context');
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Render page
      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      // Get image data
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      await pdfDoc.destroy();
    }
  }

  /**
   * Render a PDF page to a canvas element.
   */
  async renderPageToCanvas(
    file: File | ArrayBuffer,
    canvas: HTMLCanvasElement,
    pageNumber: number = 1,
    scale: number = 1.0
  ): Promise<void> {
    await this.initialize();

    if (!this.pdfjs) {
      throw new PDFExtractionError('PDF.js not initialized');
    }

    const arrayBuffer =
      file instanceof ArrayBuffer ? file : await file.arrayBuffer();

    const loadingTask = this.pdfjs.getDocument({
      data: arrayBuffer,
    }) as unknown as GetDocumentResult;

    const pdfDoc = await loadingTask.promise;

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      const context = canvas.getContext('2d');
      if (!context) {
        throw new PDFExtractionError('Failed to get canvas context');
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    } finally {
      await pdfDoc.destroy();
    }
  }

  /**
   * Check if PDF.js is initialized.
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// ============================================
// Error Class
// ============================================

/**
 * Custom error for PDF extraction failures.
 */
export class PDFExtractionError extends Error {
  constructor(
    message: string,
    public code: string = 'PDF_EXTRACTION_ERROR',
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'PDFExtractionError';
    Object.setPrototypeOf(this, PDFExtractionError.prototype);
  }
}

// ============================================
// Singleton Export
// ============================================

/**
 * Singleton instance of the PDF extractor.
 */
export const pdfExtractor = new PDFExtractorService();

/**
 * Convenience function to extract text from a PDF.
 */
export async function extractPDFText(
  file: File | ArrayBuffer,
  options?: PDFExtractionOptions
): Promise<PDFExtractionResult> {
  return pdfExtractor.extractText(file, options);
}

/**
 * Convenience function to render a PDF page to image data.
 */
export async function renderPDFPageToImage(
  file: File | ArrayBuffer,
  pageNumber?: number,
  scale?: number
): Promise<ImageData> {
  return pdfExtractor.renderPageToImage(file, pageNumber, scale);
}
