/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/chunker.ts
 * Role    : Extracts text from PDF buffers and splits into overlapping token chunks.
 *           Uses pdf-parse default extraction (no pagerender — it's unreliable across pdf.js versions).
 *           Token counting: simple char/4 approximation — avoids tiktoken WASM failures in Alpine Docker.
 *           Chunks: ~512 tokens max, ~50-token overlap. Preserves page number + chapter title.
 * Exports : extractPdfText(), chunkText(), TextChunk
 * DO NOT  : Import from apps/*, wati, payments
 */

// pdf-parse hangs if required at module level — lazy load it
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
function getPdfParse(): any { return require('pdf-parse'); }

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface TextChunk {
  text: string;
  pageNumber: number;
  chapterTitle: string | null;
  tokenCount: number;
  chunkIndex: number;
}

/**
 * Strip characters Postgres UTF8 cannot store:
 *   - Null bytes (0x00) — Postgres hard-rejects these in all text columns
 *   - Other C0/C1 control chars except \t, \n, \r (keep whitespace)
 * PDFs from embedded fonts or OCR sometimes embed these in the raw byte stream.
 */
function sanitizeForPostgres(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x00/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Approximate token count: 1 token ≈ 4 characters (GPT-family heuristic).
 * Avoids tiktoken WASM which can silently fail in Alpine Docker containers.
 */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract text from a PDF buffer using pdf-parse's default extraction.
 * Splits the flat text into per-page chunks using the page-break markers
 * that pdf-parse inserts ('\f' form-feed characters).
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<PageText[]> {
  const data = await getPdfParse()(pdfBuffer);

  if (!data.text || data.text.trim().length === 0) {
    throw new Error('PDF produced no extractable text — may be image-only or encrypted');
  }

  // pdf-parse separates pages with form-feed (\f) characters.
  // Sanitize before splitting — null bytes can appear anywhere in raw PDF text.
  const rawPages = sanitizeForPostgres(data.text).split('\f');
  const pages: PageText[] = rawPages
    .map((text: string, i: number) => ({ pageNumber: i + 1, text: text.trim() }))
    .filter((p: PageText) => p.text.length > 0);

  // If form-feed splitting gave nothing useful, treat entire doc as page 1
  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text: data.text.trim() });
  }

  return pages;
}

function detectChapterTitle(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length > 0 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return trimmed;
  }
  if (/^(chapter|bab|bagian)\s+\d+/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function chunkText(pages: PageText[], opts = { maxTokens: 512, overlap: 50 }): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  let currentChapterTitle: string | null = null;

  for (const page of pages) {
    const lines = page.text.split('\n');
    let buffer = '';
    let bufferTokens = 0;

    for (const line of lines) {
      const title = detectChapterTitle(line);
      if (title) currentChapterTitle = title;

      const lineTokens = approxTokens(line);

      if (bufferTokens + lineTokens > opts.maxTokens && buffer.length > 0) {
        chunks.push({
          text: sanitizeForPostgres(buffer.trim()),
          pageNumber: page.pageNumber,
          chapterTitle: currentChapterTitle,
          tokenCount: bufferTokens,
          chunkIndex: chunkIndex++,
        });

        // Overlap: keep last `overlap` tokens worth of text
        const words = buffer.split(' ');
        let overlapText = '';
        let overlapTokens = 0;
        for (let i = words.length - 1; i >= 0 && overlapTokens < opts.overlap; i--) {
          overlapText = words[i] + ' ' + overlapText;
          overlapTokens += approxTokens(words[i]);
        }
        buffer = overlapText + line;
        bufferTokens = approxTokens(buffer);
      } else {
        buffer += (buffer ? '\n' : '') + line;
        bufferTokens += lineTokens;
      }
    }

    if (buffer.trim().length > 0) {
      chunks.push({
        text: sanitizeForPostgres(buffer.trim()),
        pageNumber: page.pageNumber,
        chapterTitle: currentChapterTitle,
        tokenCount: bufferTokens,
        chunkIndex: chunkIndex++,
      });
    }
  }

  return chunks;
}
