/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/ingest.processor.ts
 * Role    : Processes PDF ingestion jobs from QUEUES.INGEST queue.
 *           Downloads PDF from S3/local, runs RAG pipeline (chunk + store in pgvector),
 *           generates book persona prompt, marks knowledgeStatus='ready'.
 * Imports : @lynkbot/ai, @lynkbot/db
 * Exports : ingestProcessor (BullMQ Processor function)
 * DO NOT  : Import from apps/api or apps/dashboard.
 * Job data: { productId: string, tenantId: string }
 */
import type { Processor } from 'bullmq';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db, products, productChunks, eq, sql } from '@lynkbot/db';
import { extractPdfText, chunkText, getLLMClient } from '@lynkbot/ai';
import { readFile } from 'fs/promises';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});

export interface IngestJobData {
  productId: string;
  tenantId: string;
}

/** Rejects after ms milliseconds with a clear timeout error. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export const ingestProcessor: Processor = async (job) => {
  const { productId, tenantId } = job.data as IngestJobData;

  const saveError = async (msg: string) => {
    await db.update(products)
      .set({ knowledgeStatus: 'failed', knowledgeError: msg, updatedAt: new Date() })
      .where(eq(products.id, productId));
  };

  try {
    job.log(`[1/6] Loading product record: ${productId}`);
    const product = await withTimeout(
      db.query.products.findFirst({ where: eq(products.id, productId) }),
      10_000, 'DB product lookup'
    );
    if (!product) throw new Error(`Product ${productId} not found in database`);
    if (!product.pdfS3Key) throw new Error(`Product ${productId} has no PDF uploaded`);

    // ── PDF download ──────────────────────────────────────────────────────────
    let pdfBuffer: Buffer;
    if (product.pdfS3Key.startsWith('local://')) {
      const localPath = product.pdfS3Key.replace('local://', '');
      job.log(`[2/6] Reading PDF from local disk: ${localPath}`);
      pdfBuffer = await withTimeout(readFile(localPath), 30_000, 'local file read');
    } else {
      job.log(`[2/6] Downloading PDF from S3 key=${product.pdfS3Key}`);
      const s3Response = await withTimeout(
        s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: product.pdfS3Key })),
        60_000, 'S3 download'
      );
      if (!s3Response.Body) throw new Error('S3 returned empty body');
      const chunks: Uint8Array[] = [];
      for await (const chunk of s3Response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      pdfBuffer = Buffer.concat(chunks);
    }
    job.log(`[2/6] PDF ready: ${pdfBuffer.byteLength} bytes`);

    // ── PDF text extraction ───────────────────────────────────────────────────
    job.log(`[3/6] Extracting text from PDF...`);
    const pages = await withTimeout(extractPdfText(pdfBuffer), 60_000, 'pdf-parse text extraction');
    job.log(`[3/6] Extracted ${pages.length} pages`);

    // ── Chunking ──────────────────────────────────────────────────────────────
    job.log(`[4/6] Chunking text...`);
    const chunks = chunkText(pages, { maxTokens: 512, overlap: 50 });
    if (chunks.length === 0) throw new Error('PDF produced no text chunks — may be image-only or encrypted');
    job.log(`[4/6] Produced ${chunks.length} chunks`);

    // ── DB upsert (FTS mode — no embeddings required) ─────────────────────────
    job.log(`[5/6] Upserting ${chunks.length} chunks to database...`);
    const rows = chunks.map((c) => ({
      productId,
      tenantId,
      chunkIndex: c.chunkIndex,
      contentText: c.text,
      pageNumber: c.pageNumber,
      chapterTitle: c.chapterTitle,
      tokenCount: c.tokenCount,
    }));

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      await withTimeout(
        db.insert(productChunks).values(batch).onConflictDoUpdate({
          target: [productChunks.productId, productChunks.chunkIndex],
          set: {
            contentText: sql`excluded.content_text`,
            tokenCount: sql`excluded.token_count`,
          },
        }),
        30_000, `DB upsert batch ${i}-${i + batch.length}`
      );
    }
    job.log(`[5/6] All chunks stored`);

    // ── Mark ready FIRST — then attempt persona generation ───────────────────
    // Mark ready before the LLM call so a slow/failed persona never blocks the product.
    await db.update(products).set({
      knowledgeStatus: 'ready',
      knowledgeError: null,
      updatedAt: new Date(),
    }).where(eq(products.id, productId));
    job.log(`[6/6] Product marked ready. Generating AI persona (non-blocking)...`);

    // ── Book persona (best-effort, 90s timeout) ───────────────────────────────
    try {
      const sampleContent = chunks.slice(0, 10).map((c) => c.text).join('\n\n');
      const llm = getLLMClient();
      const res = await withTimeout(
        llm.chat(
          [{ role: 'user', content: `Book: "${product.name}"\n\nSample:\n${sampleContent.slice(0, 2000)}\n\nGenerate a concise WhatsApp sales bot persona (max 200 words) that is knowledgeable about this book.` }],
          { system: 'You are an AI persona generator for book sales bots.', maxTokens: 400 }
        ),
        90_000, 'LLM persona generation'
      );
      await db.update(products)
        .set({ bookPersonaPrompt: res.content, updatedAt: new Date() })
        .where(eq(products.id, productId));
      job.log(`[6/6] Persona generated (${res.tokensUsed} tokens, ${res.latencyMs}ms)`);
    } catch (personaErr) {
      // Persona failure does NOT revert ready status — product knowledge is still usable
      job.log(`[6/6] Persona generation failed (non-fatal): ${(personaErr as Error).message}`);
    }

    job.log(`Ingest complete for product=${productId}`);

  } catch (err) {
    const errorMessage = err instanceof Error
      ? `${err.name}: ${err.message}${err.stack ? '\n' + err.stack.split('\n').slice(1, 3).join('\n') : ''}`
      : String(err);

    job.log(`FAILED at product=${productId}: ${errorMessage}`);
    await saveError(errorMessage);
    throw err;
  }
};
