/**
 * @CLAUDE_CONTEXT
 * Package : packages/ai
 * File    : src/rag/chunker.ts
 * Role    : Extracts text from PDF buffers and splits into overlapping token chunks.
 *           Uses pdf-parse for extraction, tiktoken cl100k_base for token counting.
 *           Chunks: 512 tokens max, 50-token overlap. Preserves page number + chapter title.
 * Exports : extractPdfText(), chunkText(), TextChunk
 * DO NOT  : Import from apps/*, wati, payments
 */
import type { Tiktoken } from 'tiktoken';

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

// Lazy-init: loading tiktoken WASM at module level blocks the entire process.
// Initialise only when chunkText() is first called.
let _enc: Tiktoken | null = null;
function getEnc(): Tiktoken {
  if (!_enc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { get_encoding } = require('tiktoken');
    _enc = get_encoding('cl100k_base');
  }
  return _enc!;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<PageText[]> {
  const pages: PageText[] = [];
  await getPdfParse()(pdfBuffer, {
    pagerender: (pageData) => {
      return pageData.getTextContent().then((content: { items: Array<{ str: string }> }) => {
        const text = content.items.map((item) => item.str).join(' ');
        pages.push({ pageNumber: pages.length + 1, text: text.trim() });
        return text;
      });
    },
  });
  if (pages.length === 0) {
    const data = await getPdfParse()(pdfBuffer);
    const lines = data.text.split('\n');
    pages.push({ pageNumber: 1, text: lines.join('\n') });
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

      const lineTokens = getEnc().encode(line).length;

      if (bufferTokens + lineTokens > opts.maxTokens && buffer.length > 0) {
        chunks.push({
          text: buffer.trim(),
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
          overlapTokens += getEnc().encode(words[i]).length;
        }
        buffer = overlapText + line;
        bufferTokens = getEnc().encode(buffer).length;
      } else {
        buffer += (buffer ? '\n' : '') + line;
        bufferTokens += lineTokens;
      }
    }

    if (buffer.trim().length > 0) {
      chunks.push({
        text: buffer.trim(),
        pageNumber: page.pageNumber,
        chapterTitle: currentChapterTitle,
        tokenCount: bufferTokens,
        chunkIndex: chunkIndex++,
      });
    }
  }

  return chunks;
}
