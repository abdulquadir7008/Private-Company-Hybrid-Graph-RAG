# Private Company Hybrid Graph RAG

A multi-tenant, ACL-aware **hybrid Graph RAG** assistant for private enterprises. It indexes
internal documents (PDF, DOCX, TXT, MD), builds a knowledge graph of entities and relationships,
and answers grounded questions with citations — while enforcing fine-grained role/department/owner
access at every retrieval layer.

**No API key required to run the demo.** Without an `OPENAI_API_KEY`/`HUGGINGFACE_API_KEY` the
engine still answers from the knowledge graph using a deterministic citation-based fallback;
add a key to enable a real LLM for answers and embeddings.

## Stack

| Layer | Technology |
|---|---|
| API | Node.js 20 + Express 4 + TypeScript |
| Graph | Neo4j 5.26 (APOC) |
| Vector store | Chroma |
| Relational / ACL | PostgreSQL 16 + Prisma 5.22 |
| Web | Next.js 15.5 (App Router, React 19, Tailwind) |
| Auth | JWT identity-only tokens, RBAC reloaded per request |
| Tests | Vitest |

## Quick start

```bash
# 1. Configure environment
cp .env.example .env
#    then set JWT_SECRET (openssl rand -hex 32) — required

# 2. Run the whole stack
docker compose up -d --build

# 3. Apply the Prisma schema (idempotent)
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 4. Watch the API seed the demo company (Acme Inc) on first boot,
#    then open the web app
open http://localhost:3000
```

### Local development (no containers)

```bash
npm install
npx prisma generate --schema apps/api/prisma/schema.prisma
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run dev            # API on :4000, web on :3000
```

## Demo credentials (seeded into the Acme Inc company)

All users share password `DemoPassword123!`.

| Email | Role | Sees |
|---|---|---|
| `admin@acme.com` | ADMIN | everything |
| `hr@acme.com` | HR + MANAGER | HR, leave, handbook, legal, engineering docs |
| `eng@acme.com` | MANAGER + EMPLOYEE (Engineering) | engineering/architecture docs |
| `legal@acme.com` | LEGAL | legal + internal docs |
| `employee@acme.com` | EMPLOYEE (Engineering) | non-confidential docs |
| `contractor@acme.com` | CONTRACTOR | public/internal subset only |

Documents are classified **PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED**; a contractor is
excluded from e.g. compensation, payroll, and employee-specific content — and every retrieval
path (vector, graph, keyword, evidence hydration) is re-verified against that ACL.

## What’s included

- **Document ingestion pipeline** — upload (PDF/DOCX/TXT/MD), chunk with provenance
  (page/section), embed, extract entities/relationships, resolve against the existing graph,
  write to Neo4j + Chroma + PostgreSQL, all ontology-validated.
- **Hybrid retrieval** — query planning, entity detection, ACL-filtered graph traversal,
  ACL-filtered vector search, keyword search, RRF evidence fusion and reranking.
- **Grounded answers** — LLM answers restricted to authorized evidence with `[n]` citations
  that map to real documents/chunks (never fabricated).
- **Graph explorer** — interactive custom SVG force-layout explorer over the authorized subgraph.
- **Admin console** — tenants/users, document classification, retrieval debug, audit log,
  answer feedback, graph health.
- **Security hardening** — see [docs/architecture.md](docs/architecture.md).

## Scripts

```bash
npm run dev                 # api + web concurrently
npm run build               # build api + web
npm run typecheck           # tsc --noEmit for both packages
npm run test                # vitest unit tests (api)
npm run prisma:generate
npm run prisma:migrate
```

## Configuration

All settings live in `.env` (see `.env.example`). Notable ones:

- `JWT_SECRET` (required) — `openssl rand -hex 32`
- `AI_PROVIDER` = `openai` | `huggingface`; leave API keys empty for the LLM-free demo mode
- `ENABLE_DEMO_SETUP=true` seeds the Acme Inc demo company (idempotent)
- `MAX_GRAPH_DEPTH`, `MAX_GRAPH_NODES`, `MAX_VECTOR_RESULTS`, `TOP_K_RERANKED` — retrieval caps

## Tests

```bash
npm run test
```

Covers RBAC policy decisions, Chroma access-filter construction, tenant isolation, graph ACL
predicates (fail-closed), entity/query-plan extraction, RRF reranking, citation integrity,
JWT/password handling, ontology schema guards, and grounded-answer behavior.