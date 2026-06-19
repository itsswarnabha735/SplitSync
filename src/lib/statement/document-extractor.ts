import { pdfExtractor } from "./pdf-extractor";

export type StatementExtractionStage = "validating" | "extracting" | "ocr";

export interface StatementExtractionProgress {
  stage: StatementExtractionStage;
  progress: number;
  currentPage?: number;
  totalPages?: number;
}

export interface StatementExtractionResult {
  rawText: string;
  fileMetadata: {
    originalName: string;
    mimeType: string;
    size: number;
    pageCount: number | null;
  };
  ocrUsed: boolean;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function validateStatementFile(file: File): string | null {
  if (!file) return "Choose a statement file.";
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > MAX_FILE_SIZE) return "Statement files must be 25MB or smaller.";
  if (!SUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) {
    return "Upload a PDF, JPEG, PNG, or WebP statement.";
  }
  return null;
}

export async function extractStatementText(
  file: File,
  onProgress?: (progress: StatementExtractionProgress) => void
): Promise<StatementExtractionResult> {
  const validationError = validateStatementFile(file);
  if (validationError) throw new Error(validationError);

  onProgress?.({ stage: "validating", progress: 100 });

  const mimeType = file.type.toLowerCase();
  if (mimeType === "application/pdf") {
    const result = await pdfExtractor.extractText(file, {
      onProgress: (progress) =>
        onProgress?.({
          stage: "extracting",
          progress: progress.percentComplete,
          currentPage: progress.currentPage,
          totalPages: progress.totalPages,
        }),
    });

    let text = result.text;
    let ocrUsed = false;
    if (result.isImageBased || text.trim().length < 100) {
      text = await ocrPdfPages(file, result.pageCount, onProgress);
      ocrUsed = true;
    }

    return {
      rawText: text,
      fileMetadata: {
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        pageCount: result.pageCount,
      },
      ocrUsed,
    };
  }

  const text = await ocrImage(file, (progress) =>
    onProgress?.({ stage: "ocr", progress })
  );
  return {
    rawText: text,
    fileMetadata: {
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      pageCount: null,
    },
    ocrUsed: true,
  };
}

async function ocrImage(
  image: File | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      if (message.status === "recognizing text") {
        onProgress?.(Math.round(message.progress * 100));
      }
    },
  });

  try {
    const result = await worker.recognize(image);
    return normalizeOcrText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

async function ocrPdfPages(
  file: File,
  pageCount: number,
  onProgress?: (progress: StatementExtractionProgress) => void
): Promise<string> {
  await pdfExtractor.initialize();
  const pdfjs = pdfExtractor.getPdfJsForRendering();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdfDoc = await loadingTask.promise;
  const pageTexts: string[] = [];

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      const text = await ocrImage(canvas, (progress) =>
        onProgress?.({
          stage: "ocr",
          progress: Math.round(((pageNum - 1) / pageCount) * 100 + progress / pageCount),
          currentPage: pageNum,
          totalPages: pageCount,
        })
      );
      pageTexts.push(text);
    }
  } finally {
    await pdfDoc.destroy();
  }

  return pageTexts.join("\n\n");
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/(?<!\d)3(\d{1,6}\.\d{2})(?!\d)/g, "₹$1")
    .replace(/(?<!\w)[zZ](\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?!\d)/g, "₹$1")
    .replace(/\bRs?\s*[.,:]?\s*(\d)/gi, "Rs. $1");
}
