/**
 * @CLAUDE_CONTEXT
 * Package : apps/worker
 * File    : src/processors/ingest.processor.ts
 * Role    : Processes PDF ingestion jobs from QUEUES.INGEST queue.
 *           Downloads PDF from S3, runs RAG pipeline (chunk + embed + store in pgvector),
 *           generates book persona prompt, marks knowledgeStatus='ready'.
 * Imports : @lynkbot/ai, @lynkbot/db
 * Exports : ingestProcessor (BullMQ Processor function)
 * DO NOT  : Import from apps/api or apps/dashboard.
 * Job data: { productId: string, tenantId: string }
 */
import type { Processor } from 'bullmq';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db, products } from '@lynkbot/db';
import { ingest } from '@lynkbot/ai';
import { eq } from '@lynkbot/db';
import { readFile } from 'fs/promises';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

export interface IngestJobData {
  productId: string;
  tenantId: string;
}

export const ingestProcessor: Processor = async (job) => {
  const { productId, tenantId } = job.data as IngestJobData;

  job.log(`Starting PDF ingest for product=${productId} tenant=${tenantId}`);

  // 1. Mark as processing so the API can report progress to the Lynker
  await db
    .update(products)
    .set({ knowledgeStatus: 'processing' })
    .where(eq(products.id, productId));

  try {
    // 2. Load product record to find the S3 key
    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
    });

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    if (!product.pdfS3Key) {
      throw new Error(`Product ${productId} has no pdfS3Key — cannot ingest`);
    }

    let pdfBuffer: Buffer;

    if (product.pdfS3Key.startsWith('local://')) {
      // Local filesystem storage (development / no S3 configured)
      const localPath = product.pdfS3Key.replace('local://', '');
      job.log(`Reading PDF from local disk: ${localPath}`);
      pdfBuffer = await readFile(localPath);
    } else {
      // S3 storage
      job.log(`Downloading PDF from S3: bucket=${process.env.S3_BUCKET} key=${product.pdfS3Key}`);

      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: product.pdfS3Key,
      });

      const s3Response = await s3.send(command);

      if (!s3Response.Body) {
        throw new Error(`S3 returned empty body for key=${product.pdfS3Key}`);
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of s3Response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      pdfBuffer = Buffer.concat(chunks);
    }

    job.log(`PDF downloaded: ${pdfBuffer.byteLength} bytes. Running RAG pipeline...`);

    // 4. Run the full RAG ingest pipeline:
    //    - Parse PDF text
    //    - Chunk into overlapping segments
    //    - Embed each chunk with OpenAI text-embedding-3-small
    //    - Upsert into pgvector (document_chunks table)
    //    - Generate a book persona system prompt and store on the product
    //    - Set knowledgeStatus = 'ready'
    await ingest(productId, tenantId, pdfBuffer);

    job.log(`Ingest complete for product=${productId}`);
  } catch (err) {
    // Store the full error message so the dashboard can surface exactly what went wrong
    const errorMessage = err instanceof Error
      ? `${err.name}: ${err.message}${err.stack ? '\n' + err.stack.split('\n').slice(1, 4).join('\n') : ''}`
      : String(err);

    job.log(`Ingest FAILED for product=${productId}: ${errorMessage}`);

    await db
      .update(products)
      .set({ knowledgeStatus: 'failed', knowledgeError: errorMessage, updatedAt: new Date() })
      .where(eq(products.id, productId));

    throw err; // Re-throw so BullMQ marks the job as failed and applies retry policy
  }
};
