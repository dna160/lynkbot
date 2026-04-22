/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/products.ts
 * Role    : Product CRUD routes + S3 presigned URL + ingest trigger.
 *           All routes require JWT auth. tenantId extracted from JWT claims.
 * Exports : productRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from '@lynkbot/db';
import { db, products, inventory } from '@lynkbot/db';
import { Queue } from 'bullmq';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { QUEUES } from '@lynkbot/shared';
import { config } from '../../config';

const ingestQueue = new Queue(QUEUES.INGEST, { connection: { url: config.REDIS_URL } });

const s3 = new S3Client({
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  },
  ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
});

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(100).optional(),
  description: z.string().optional(),
  tagline: z.string().max(500).optional(),
  targetReader: z.string().optional(),
  problemsSolved: z.array(z.string()).optional(),
  keyOutcomes: z.array(z.string()).optional(),
  faqPairs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  testimonials: z.array(z.string()).optional(),
  priceIdr: z.number().int().positive(),
  weightGrams: z.number().int().nonnegative().default(0),
  dimensionsCm: z.object({ l: z.number(), w: z.number(), h: z.number() }).optional(),
  bookPersonaPrompt: z.string().optional(),
});

const updateProductSchema = createProductSchema.partial();

export const productRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/products
   * List all active products for the authenticated tenant.
   */
  fastify.get(
    '/v1/products',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const rows = await db.select().from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)));
      return reply.send(rows);
    },
  );

  /**
   * POST /v1/products
   * Create a new product and seed an inventory record.
   */
  fastify.post(
    '/v1/products',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const parsed = createProductSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      }

      const [product] = await db.insert(products).values({
        tenantId,
        ...parsed.data,
        knowledgeStatus: 'pending',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      // Seed inventory record
      await db.insert(inventory).values({
        productId: product.id,
        tenantId,
        quantityAvailable: 0,
        quantityReserved: 0,
        quantitySold: 0,
        lowStockThreshold: 5,
        updatedAt: new Date(),
      }).onConflictDoNothing();

      return reply.status(201).send(product);
    },
  );

  /**
   * GET /v1/products/:id
   * Get a single product with its inventory.
   */
  fastify.get<{ Params: { id: string } }>(
    '/v1/products/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
      });

      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const inv = await db.query.inventory.findFirst({
        where: and(eq(inventory.productId, id), eq(inventory.tenantId, tenantId)),
      });

      return reply.send({ ...product, inventory: inv ?? null });
    },
  );

  /**
   * PATCH /v1/products/:id
   * Update product fields.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/v1/products/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const parsed = updateProductSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      }

      const [updated] = await db.update(products)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
        .returning();

      if (!updated) return reply.status(404).send({ error: 'Product not found' });
      return reply.send(updated);
    },
  );

  /**
   * DELETE /v1/products/:id
   * Soft delete — sets isActive=false.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/v1/products/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const [updated] = await db.update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
        .returning();

      if (!updated) return reply.status(404).send({ error: 'Product not found' });
      return reply.status(204).send();
    },
  );

  /**
   * POST /v1/products/:id/upload-url
   * Generate S3 presigned PUT URL for PDF or image upload.
   * Query: ?type=pdf|image
   */
  fastify.post<{ Params: { id: string }; Querystring: { type?: string } }>(
    '/v1/products/:id/upload-url',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;
      const fileType = request.query.type === 'pdf' ? 'pdf' : 'image';

      const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
      });
      if (!product) return reply.status(404).send({ error: 'Product not found' });

      const ext = fileType === 'pdf' ? 'pdf' : 'jpg';
      const contentType = fileType === 'pdf' ? 'application/pdf' : 'image/jpeg';
      const s3Key = `tenants/${tenantId}/products/${id}/${fileType}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: s3Key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 minutes

      // Store s3 key on product
      const updateField = fileType === 'pdf' ? { pdfS3Key: s3Key } : { coverImageUrl: s3Key };
      await db.update(products)
        .set({ ...updateField, updatedAt: new Date() })
        .where(eq(products.id, id));

      return reply.send({ uploadUrl, s3Key, expiresIn: 900 });
    },
  );

  /**
   * POST /v1/products/:id/ingest
   * Enqueue RAG ingest job for the product's PDF.
   */
  fastify.post<{ Params: { id: string } }>(
    '/v1/products/:id/ingest',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { tenantId } = request.user;
      const { id } = request.params;

      const product = await db.query.products.findFirst({
        where: and(eq(products.id, id), eq(products.tenantId, tenantId)),
      });
      if (!product) return reply.status(404).send({ error: 'Product not found' });
      if (!product.pdfS3Key) {
        return reply.status(422).send({ error: 'No PDF uploaded for this product' });
      }

      await db.update(products)
        .set({ knowledgeStatus: 'processing', updatedAt: new Date() })
        .where(eq(products.id, id));

      await ingestQueue.add('ingest-product', {
        productId: id,
        tenantId,
        s3Key: product.pdfS3Key,
      });

      return reply.status(202).send({ message: 'Ingest job enqueued', productId: id });
    },
  );
};
