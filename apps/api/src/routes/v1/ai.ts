/**
 * @CLAUDE_CONTEXT
 * Package : apps/api
 * File    : src/routes/v1/ai.ts
 * Role    : AI-assisted content generation endpoints for the dashboard.
 *           generate-product-copy: given a product name + brief, returns AI-generated
 *           description, FAQ pairs, key outcomes, and sales persona prompt.
 *           chat: single-turn AI assistant for dashboard operators.
 * Exports : aiRoutes (Fastify plugin)
 */
import type { FastifyPluginAsync } from 'fastify';
import { getLLMClient } from '@lynkbot/ai';

export const aiRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/ai/generate-product-copy
   * Generate product marketing copy using xAI/Grok.
   * Body: { name, brief?, existingDescription?, language? }
   */
  fastify.post<{
    Body: {
      name: string;
      brief?: string;
      existingDescription?: string;
      language?: 'id' | 'en';
    }
  }>(
    '/v1/ai/generate-product-copy',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { name, brief, existingDescription, language = 'id' } = request.body ?? {};

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const systemPrompt = language === 'id'
        ? `Kamu adalah copywriter e-commerce profesional yang ahli dalam menulis konten produk digital untuk pasar Indonesia. Selalu jawab dalam Bahasa Indonesia. Fokus pada manfaat emosional dan hasil nyata, bukan fitur teknis. Gaya bahasa: hangat, persuasif, dan kepercayaan tinggi.`
        : `You are a professional e-commerce copywriter specializing in digital products. Focus on emotional benefits and tangible outcomes, not technical features. Tone: warm, persuasive, high-trust.`;

      const userPrompt = [
        `Buat konten pemasaran lengkap untuk produk berikut:`,
        `Nama produk: ${name}`,
        brief ? `Brief: ${brief}` : '',
        existingDescription ? `Deskripsi saat ini (gunakan sebagai referensi): ${existingDescription}` : '',
        ``,
        `Hasilkan dalam format JSON yang valid dengan struktur berikut:`,
        `{`,
        `  "description": "deskripsi produk 2-3 paragraf yang menarik",`,
        `  "tagline": "tagline singkat max 80 karakter",`,
        `  "keyOutcomes": ["outcome 1", "outcome 2", "outcome 3", "outcome 4", "outcome 5"],`,
        `  "problemsSolved": ["masalah 1", "masalah 2", "masalah 3"],`,
        `  "faqPairs": [`,
        `    {"q": "pertanyaan 1", "a": "jawaban 1"},`,
        `    {"q": "pertanyaan 2", "a": "jawaban 2"},`,
        `    {"q": "pertanyaan 3", "a": "jawaban 3"},`,
        `    {"q": "pertanyaan 4", "a": "jawaban 4"},`,
        `    {"q": "pertanyaan 5", "a": "jawaban 5"}`,
        `  ],`,
        `  "bookPersonaPrompt": "instruksi singkat untuk AI sales bot tentang cara menjual produk ini (max 200 kata)"`,
        `}`,
        ``,
        `Penting: hanya output JSON valid, tidak ada teks lain di luar JSON.`,
      ].filter(Boolean).join('\n');

      const llm = getLLMClient();

      try {
        const response = await llm.chat(
          [{ role: 'user', content: userPrompt }],
          {
            system: systemPrompt,
            maxTokens: 2048,
            temperature: 0.8,
            responseFormat: 'json_object',
          },
        );

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(response.content);
        } catch {
          return reply.status(502).send({ error: 'AI returned malformed JSON', raw: response.content });
        }

        return reply.send({
          ...parsed,
          _meta: { modelId: response.modelId, tokensUsed: response.tokensUsed, latencyMs: response.latencyMs },
        });
      } catch (err: any) {
        return reply.status(502).send({ error: `AI generation failed: ${err?.message ?? 'unknown'}` });
      }
    },
  );

  /**
   * POST /v1/ai/chat
   * Single-turn assistant for dashboard operators (not buyer-facing).
   * Body: { message, context? }
   */
  fastify.post<{
    Body: { message: string; context?: string }
  }>(
    '/v1/ai/chat',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { message, context } = request.body ?? {};

      if (!message?.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      const llm = getLLMClient();
      const systemPrompt = [
        'You are a helpful business assistant for LynkBot, a WhatsApp commerce automation platform.',
        'You help store operators with: product copy, customer service scripts, business strategy, order handling.',
        'Be concise and practical. Respond in the same language the user writes in.',
        context ? `\nBusiness context:\n${context}` : '',
      ].filter(Boolean).join('\n');

      try {
        const response = await llm.chat(
          [{ role: 'user', content: message }],
          { system: systemPrompt, maxTokens: 1024, temperature: 0.7 },
        );

        return reply.send({
          reply: response.content,
          _meta: { modelId: response.modelId, tokensUsed: response.tokensUsed, latencyMs: response.latencyMs },
        });
      } catch (err: any) {
        return reply.status(502).send({ error: `AI error: ${err?.message ?? 'unknown'}` });
      }
    },
  );
};
