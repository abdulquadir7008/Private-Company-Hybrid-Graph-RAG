import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import officeparser from "officeparser";
import { AppError } from "../errors.js";

export interface ExtractedText {
  text: string;
  pageCount: number;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function validateUploadedFile(file: Express.Multer.File): void {
  if (!file) throw new AppError(400, "No file uploaded", "NO_FILE", "file");
  if (file.size > MAX_FILE_BYTES) {
    throw new AppError(400, "File exceeds 25MB limit", "FILE_TOO_LARGE", "file");
  }
  const allowed = [".pdf", ".docx", ".doc", ".txt", ".md", ".pptx", ".xlsx"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext)) {
    throw new AppError(400, `Unsupported file type "${ext}"`, "UNSUPPORTED_TYPE", "file");
  }
}

/** Extract raw text plus approximate page count from an uploaded file. */
export async function extractTextFromFile(filePath: string, mimeType: string, originalName: string): Promise<ExtractedText> {
  const ext = path.extname(originalName).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  switch (ext) {
    case ".pdf":
      return extractPdf(buffer);
    case ".docx": {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, pageCount: 0 };
    }
    case ".doc":
    case ".pptx":
    case ".xlsx": {
      const text = await officeparser.parseOfficeAsync(buffer);
      return { text, pageCount: 0 };
    }
    case ".txt":
    case ".md":
      return { text: buffer.toString("utf-8"), pageCount: 0 };
    default:
      return { text: buffer.toString("utf-8"), pageCount: 0 };
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  const data = await pdfParse(buffer);
  return { text: data.text, pageCount: data.numpages ?? 0 };
}

/** Segment already-marked page breaks if present. */
export function splitPages(extracted: ExtractedText): { page: number; text: string }[] {
  if (extracted.pageCount === 0) return [{ page: 1, text: extracted.text }];
  const marker = "\f";
  const pages = extracted.text.split(marker).filter((p) => p.trim().length > 0);
  if (pages.length <= 1) return [{ page: 1, text: pages[0] ?? extracted.text }];
  return pages.map((text, i) => ({ page: i + 1, text }));
}