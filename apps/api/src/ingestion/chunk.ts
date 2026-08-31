import type { DocumentSection } from "./structure.js";

export interface ChunkResult {
  content: string;
  index: number;
  section: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
}

const CHUNK_SIZE = 700; // approx tokens
const CHUNK_OVERLAP = 120;

function roughTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sentence-aware chunking with overlap. Uses section boundaries where
 * available so a chunk never mixes unrelated sections when avoidable.
 */
export function chunkDocument(content: string, sections: DocumentSection[], pages: { page: number; startIndex: number; endIndex: number }[]): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  let index = 0;

  const pageAt = (offset: number): number | null => {
    for (const p of pages) {
      if (offset >= p.startIndex && offset <= p.endIndex) return p.page;
    }
    return null;
  };

  const sectionAt = (offset: number): string | null => {
    for (const s of [...sections].reverse()) {
      if (offset >= s.startIndex) return s.title;
    }
    return null;
  };

  // Split content into section blocks first.
  const splitPoints = [0];
  for (const s of sections) {
    if (s.startIndex > 0 && !splitPoints.includes(s.startIndex)) splitPoints.push(s.startIndex);
  }
  splitPoints.push(content.length);
  splitPoints.sort((a, b) => a - b);

  for (let i = 0; i < splitPoints.length - 1; i++) {
    const blockStart = splitPoints[i];
    const blockEnd = splitPoints[i + 1];
    const block = content.slice(blockStart, blockEnd).trim();
    if (!block) continue;

    const sentences = block.match(/[^.!?\n]+[.!?]?/g) ?? [block];
    let buffer = "";
    const flush = () => {
      if (!buffer.trim()) return;
      const startOffset = index;
      chunks.push({
        content: buffer.trim(),
        index: startOffset,
        section: sectionAt(blockStart),
        pageStart: pageAt(blockStart),
        pageEnd: pageAt(blockEnd),
        tokenCount: roughTokens(buffer)
      });
      buffer = "";
    };

    for (const sentence of sentences) {
      const probe = buffer ? `${buffer} ${sentence}` : sentence;
      if (roughTokens(probe) > CHUNK_SIZE && buffer) {
        flush();
        const overlap = takeOverlap(buffer, CHUNK_OVERLAP);
        buffer = overlap ? `${overlap} ${sentence}` : sentence;
        index += 1;
      } else {
        buffer = probe;
      }
    }
    flush();
    index += 1;
  }
  return chunks;
}

function takeOverlap(text: string, targetTokens: number): string {
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [];
  const out: string[] = [];
  let tokens = 0;
  for (const s of sentences.reverse()) {
    out.unshift(s.trim());
    tokens += roughTokens(s);
    if (tokens >= targetTokens) break;
  }
  return out.join(" ");
}