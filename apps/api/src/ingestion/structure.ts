export interface DocumentSection {
  id: string;
  title: string;
  headingLevel: number;
  page: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Lightweight structure detection: splits documents into sections using
 * common heading conventions (##, #, numbered headings, ALL-CAPS lines) and
 * form feed based page boundaries.
 */
const HEADING_RE =
  /^(#{1,6}\s+.+|(\d+(?:\.\d+)*(?:\.)?\s+[A-Z][A-Za-z0-9 ,'&-]{2,})(?::|\.)?|[A-Z][A-Z][A-Z0-9 ,'&():-]{4,}|(?:Article|Section|Policy|Procedure|Step)\s+\d+.*)$/;

export function detectStructure(content: string): { sections: DocumentSection[]; pages: { page: number; startIndex: number; endIndex: number }[] } {
  const lines = content.split("\n");
  const sections: DocumentSection[] = [];
  const pages: { page: number; startIndex: number; endIndex: number }[] = [];

  let offset = 0;
  let page = 1;
  let pageStart = 0;
  let currentSection: DocumentSection | null = null;
  let index = 0;

  for (const line of lines) {
    const lineLen = line.length + 1;
    if (line.includes("\f")) {
      pages.push({ page, startIndex: pageStart, endIndex: offset });
      page += 1;
      pageStart = offset;
    }
    const stripped = line.trim();
    let headingLevel = 0;
    let matched = false;
    const match = HEADING_RE.exec(stripped);
    if (match) {
      headingLevel = stripped.startsWith("#") ? Math.min(stripped.match(/^#+/)![0].length, 6) : match[2] ? 2 : 3;
      matched = true;
    }
    if (matched) {
      if (currentSection) {
        currentSection.endIndex = offset;
        sections.push(currentSection);
      }
      currentSection = {
        id: `sec-${index++}`,
        title: stripped.replace(/^#+\s*/, "").slice(0, 200),
        headingLevel,
        page,
        startIndex: offset,
        endIndex: content.length
      };
    }
    offset += lineLen;
  }
  if (currentSection) {
    currentSection.endIndex = content.length;
    sections.push(currentSection);
  }
  pages.push({ page, startIndex: pageStart, endIndex: content.length });
  return { sections, pages };
}

export function sectionForOffset(sections: DocumentSection[], offset: number): string | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (offset >= sections[i].startIndex) return sections[i].title;
  }
  return null;
}