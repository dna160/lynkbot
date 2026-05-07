/**
 * @CLAUDE_CONTEXT
 * Script  : infra/scripts/migrate-pdfs.ts
 * Role    : One-time migration: exports existing pdf_bytes from PostgreSQL
 *           to S3, then updates products.pdf_s3_key and products.pdf_uploaded_at.
 * Usage   : npx tsx infra/scripts/migrate-pdfs.ts
 */
import { db, products, eq, sql } from '@lynkbot/db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Bucket = process.env.S3_BUCKET;
if (!s3Bucket) {
  console.error('S3_BUCKET env var is required');
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: !!process.env.S3_ENDPOINT,
});

async function main() {
  const rows = await db.select().from(products).where(sql`${products.pdfBytes} IS NOT NULL`);
  console.log(`Found ${rows.length} products with inline PDF bytes`);

  let migrated = 0;
  let failed = 0;

  for (const product of rows) {
    if (!product.pdfBytes) continue;

    const key = `tenants/${product.tenantId}/products/${product.id}/catalog.pdf`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: key,
          Body: product.pdfBytes,
          ContentType: 'application/pdf',
        }),
      );

      await db
        .update(products)
        .set({ pdfS3Key: key, pdfUploadedAt: new Date() })
        .where(eq(products.id, product.id));

      migrated++;
      console.log(`Migrated product ${product.id} → s3://${s3Bucket}/${key}`);
    } catch (err) {
      failed++;
      console.error(`Failed to migrate product ${product.id}:`, err);
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${failed} failed`);
  console.log('After verification, run: ALTER TABLE products DROP COLUMN pdf_bytes;');
}

main().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
