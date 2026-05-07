# LynkBot

WhatsApp Commerce Platform for Indonesian SMBs.

**Documentation:** See [`implementation.md`](./implementation.md) for full architecture, API reference, and development guide.

**Quick Start:**
```bash
pnpm install
cp .env.example .env
# Edit .env with your credentials
pnpm db:migrate
pnpm dev
```

**Branches:**
- `main` — stable release
- `kimi-grow` — v1.0 commercial hardening (merge pending)

**Tech Stack:**
- Turborepo + pnpm + Node ≥20
- Fastify API + BullMQ workers
- PostgreSQL + pgvector
- React dashboard + Tailwind CSS
- Meta WhatsApp Business API
