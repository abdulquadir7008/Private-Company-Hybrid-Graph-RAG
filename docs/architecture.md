# Architecture — Private Company Hybrid Graph RAG

## 1. Overview

```
┌──────────────┐     ┌────────────────────────────────────────────────┐
│  Next.js web │────▶│  Express API  :4000                             │
│  :3000       │     │                                                │
│  chat / graph│     │  JWT auth → RBAC → query planner               │
│  admin       │◀────│  → ACL-filtered hybrid retrieval → answer      │
└──────────────┘     │  ingestion pipeline / admin / audit           │
                     └────┬──────────┬──────────┬─────────────────────┘
                          │          │          │
                     ┌────▼───┐  ┌───▼────┐  ┌──▼──────────┐
                     │ Neo4j  │  │ Chroma │  │ PostgreSQL  │
                     │ graph  │  │ vectors│  │ docs/chunks │
                     │ 5.26   │  │       │  │ ACL / RBAC  │
                     └────────┘  └────────┘  └─────────────┘
```

- **PostgreSQL (Prisma 5)** is the system of record: companies, users, sessions, documents,
  chunks, ACL grants, ingestion jobs, audit log, chat feedback.
- **Neo4j** stores the shared knowledge graph: entities (`:Entity`, `:Chunk`) and typed
  relationships (`OWNS`, `MANAGES`, `PART_OF`, `DEPENDS_ON`, …). Relationship and node tokens
  point back at the *source document ids* that support them.
- **Chroma** stores chunk embeddings with document-level ACL flags in metadata so vector search
  is filtered natively.

## 2. Tenancy & document classification

Every row and every graph element carries the owning company id (`companyId` / `tenantId`).
Documents are classified by an admin into one of:

| Classification | Default visibility |
|---|---|
| `PUBLIC` | all members of the tenant |
| `INTERNAL` | all members |
| `CONFIDENTIAL` | role/department/owner grants |
| `RESTRICTED` | grants only (+ platform root admin) |

An ACL record is an OR of grants: allowed roles, allowed departments, and an optional owner
user. The policy engine derives a per-user predicate once per request (see §4).

## 3. Auth & RBAC

- **Identity-only JWTs.** Tokens carry `sub`, `email`, `companyId`, `roleScope`
  (`company` | `root`) and `sessionId` — never roles/permissions. Login checks the password hash,
  and permission state is **reloaded from Postgres on every request**, so role changes take
  effect immediately and tokens can be revoked by deleting the session.
- **Principal** = `{ userId, email, companyId, roles, department, isRootAdmin }` built per
  request from the current session + DB. Cross-tenant users are locked to their company;
  `roleScope: root` grants platform-admin access across tenants.
- RBAC helpers (`canAccess`, `isAdmin`, `assertPrincipalForTenant`) are pure functions in
  `apps/api/src/access/policy.ts` and are covered by unit tests.

## 4. ACL enforcement — every path fail-closed

Access is verified at **each** layer; none trusts another:

| Layer | Enforced how |
|---|---|
| Postgres: documents | `companyId` + `classification/owner` checks + `canAccess` + `resolveAcl` |
| Neo4j: graph traversal | Cypher predicate `` `all(d IN e.sourceDocuments WHERE d IN $authDocs)` `` — a relationship is only visible if **every** supporting doc is authorized. `tenantId` is always pinned as a parameter. |
| Chroma: vector search | `where` filter: `$and = [ {companyId}, { $or: [role-flag, dept-flag, owner] } ]` built by `buildChromaAccessFilter` |
| Expected-chunk hydration | evidence is hydrated only from chunks/documents the principal can `read`; unauthorized chunks return `null` |

`graphStats(tenantId, authorizedDocIds)` exposes tenant + ACL-scoped counts only.

## 5. Hybrid retrieval pipeline

`POST /api/chat` → `apps/api/src/retrieval/hybrid.ts`:

1. **Query planning** (`queryPlanner.ts`) — `classifyKind` routes:
   `relationship_lookup`, `multi_hop`, `hybrid`, `semantic_lookup`, `summarize`.
2. **Entity detection** — `extractEntityNameCandidates` finds Capitalized-Word runs and
   resolves them to existing graph entities (normalized names); keywords fall back to
   plain-text search.
3. **ACL-filtered graph traversal** (`graph/retrieve.ts`) — Cypher over authorized `$authDocs`
   with caps (`MAX_GRAPH_DEPTH`, `MAX_GRAPH_NODES`).
4. **ACL-filtered vector search** (`vector/chroma.ts`) — embeddings (OpenAI/HF, or skipped
   gracefully in demo mode) with the metadata access filter.
5. **Keyword search** (PostgreSQL full-text on chunks) + **path search** (shortest greenery
   between detected entities).
6. **RRF fusion** (`rerank.ts`) — Reciprocal Rank Fusion merges the four evidence groups and
   ranks by supporting-list coverage; capped by `TOP_K_RERANKED`.
7. **Hydration** (`hydrateEvidence`) — maps each evidence item back to its `pg` chunk and
   document; re-checks authorization; drops unauthorized.
8. **Answering** (`answer/generate.ts`) —
   - `hasLLM`: the LLM receives only the authorized evidence text and is told to answer solely
     from it.
   - No `LLM` (demo): deterministic, citation-aware `fallbackAnswer` that walks the evidence and
     cites `[n]` per source.
   - No relevant evidence → explicit refusal (never a hallucinated "no access" from mode).

**Citations** (`answer/citations.ts`) — `buildCitations` dedupes evidence by
`documentId:chunkId` while preserving a **strictly sequential `index`**, so `[1]…[n]` always
map 1:1 to expansion order. `grounded=true` only when the final text is verified against
actual delivered evidence.

## 6. Ingestion pipeline

`apps/api/src/ingestion/pipeline.ts` (runs per uploaded document, idempotent, job-tracked):

```
extract text (PDF/DOCX/TXT/MD, page splits)
  → structure/detect (sections)
  → chunk (preserving chunkId, section, pageStart, provenance per chunk)
  → ACL flags computed from the document's classification
  → embed chunk → upsert Chroma (node: `<chunkId>::<index>) with ACL metadata
  → extract entities + relationships (LLM or heuristic fallback)
  → ontology validation (allowed node/edge types) → drop invalid
  → resolve/normalize entity names (dedupe avoid "HR Dept" vs "HR Department")
  → upsert Neo4j Entity/Chunk nodes + typed relationships with
    `sources`/`sourceDocuments` provenance + `linkChunkMention` for chunk→entity
```

Re-running ingestion on the same document supersedes prior jobs and upserts in place. The
graph grows by merging across documents, so a single entity can accumulate evidence from many
sources — all captured in its provenance.

## 7. Security decisions & constraints

- **Fail closed**: unknown classifications / unauthenticated principals / unauthorized chunks
  all resolve to *no access* rather than permissive defaults.
- **Identity-only JWTs + per-request RBAC**: no stale roles, instant revocation.
- **Never trust the vector store for authorization**: Chroma metadata filtering is defense in
  depth; every evidence item is re-authorized at hydration against Postgres + the graph.
- **Provenance everywhere**: graph edges carry the document ids that justify them, so answers
  can only cite documents the questioner can read.
- No secrets in clients; `JWT_SECRET` must be set (no default), JWTs are signed-only (identity)
  and session deletion revokes them.
- Demo mode (no AI keys) is an intentional, documented degradation: embeddings/LLM skipped,
  graph-evidence grounding still enforced.

## 8. Operations

- Run: `docker compose up -d --build` → migrate (`npx prisma migrate deploy -s apps/api/prisma/schema.prisma`) →
  seed on boot (`ENABLE_DEMO_SETUP=true`). Health endpoint: `GET /api/health`.
- Neo4j browser: `http://localhost:7474`, Chroma UI: `http://localhost:8000/api/v2`.
- Debug: admin → Retrieval Debug replays an ACL-filtered hybrid query with per-source scores.
- Tests (`npm run test`): access policy, Chroma filter construction, graph ACL predicates,
  the retrieval pipeline units, citation integrity, and query planning.