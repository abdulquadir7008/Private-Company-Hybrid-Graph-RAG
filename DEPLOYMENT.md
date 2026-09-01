# Deployment Guide

This guide walks through deploying the Private Company Hybrid Graph RAG app to free hosting:
**Vercel** (frontend), **Render** (API), **Neon** (PostgreSQL), **Neo4j Aura** (graph), and
**Chroma Cloud** (vector store).

## Architecture

```
User → Vercel (Next.js) ──→ Render (Node.js API) ──→ Neon (PostgreSQL)
                                                    ├──→ Neo4j Aura (graph)
                                                    └──→ Chroma Cloud (vectors)
```

---

## 1. Set up the databases (do these first)

### 1a. PostgreSQL — Neon (free)

1. Go to https://console.neon.tech and sign up.
2. Create a new project (region `US East (Ohio)`).
3. Open **Connection Details** → **Pooled connection**.
4. Copy the connection string; it looks like:
   ```
   postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Rename the database in the URL to `graphrag` (or create a db named `graphrag`).
5. Save this for later — it's your `DATABASE_URL`.

> Note: Neon's free tier is serverless and never sleeps. Perfect for Render's free tier
> which spins down on inactivity.

### 1b. Neo4j — Aura Free

1. Go to https://console.neo4j.cloud and sign up.
2. Create a **Free** instance (region near you).
3. Set a database password and save it.
4. Open **Connect** → **Connection string** (the `neo4j+s://xxxx.databases.neo4j.io` URL).
5. You now have:
   - `NEO4J_URI` = the connection string
   - `NEO4J_USERNAME` = `neo4j`
   - `NEO4J_PASSWORD` = the password you set

### 1c. Chroma — Chroma Cloud (free)

1. Go to https://cloud.trychroma.com and sign up.
2. Create a new collection, e.g. `graphrag_chunks`.
3. Get the API base URL (e.g. `https://api.trychroma.com/<tenant>/<database>`).
4. Save this as `CHROMA_URL`.

> Note: If Chroma Cloud free isn't available in your region, you can skip the real LLM/
> embeddings and rely on the built-in **LLM-free demo mode** (keyword + graph retrieval).
> In that case, leave Chroma unconfigured and set `AI_PROVIDER` accordingly — the API
> handles missing vector setup gracefully.

---

## 2. Deploy the API to Render

### Option A: Render Blueprint (uses render.yaml, auto)

1. Push this repo to GitHub.
2. On Render: **New** → **Blueprint**.
3. Select the repo. Render reads `render.yaml` and creates the `graphrag-api` service.
4. Fill in the `sync: false` env vars that Render asks for:
   - `DATABASE_URL` (from step 1a)
   - `NEO4J_URI` (from step 1b)
   - `NEO4J_PASSWORD` (from step 1b)
   - `CHROMA_URL` (from step 1c)
   - `OPENAI_API_KEY` (optional, for real LLM answers)
   - `JWT_SECRET` (generate: `openssl rand -hex 32`)
   - `WEB_URL` (your Vercel URL, from step 3)
5. Deploy.

### Option B: Manual Render web service (equivalent)

1. **New** → **Web Service** → connect repo.
2. **Runtime**: Docker.
3. **Dockerfile path**: `apps/api/Dockerfile`.
4. Set all env vars from `.env.production.example`.
5. Health check path: `/api/health`.
6. **Create Web Service**.

> Free-tier caveats: Render free services spin down after 15 min of inactivity and
> take ~30-60s to cold-start. The seeded demo data persists in Neon/Neo4j/Chroma,
> so a restart is fine. Note your Render URL, e.g. `https://graphrag-api.onrender.com`.

---

## 3. Deploy the frontend to Vercel

1. Go to https://vercel.com → **Add New Project** → import the GitHub repo.
2. Vercel auto-detects Next.js.
3. **Root Directory**: `apps/web` (point Vercel into the web app).
4. Vercel will then use `apps/web/package.json` for the build.
5. In **Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` = `https://graphrag-api.onrender.com/api`
     (your Render URL + `/api`)
6. Deploy.

> After deploy, visit `https://<your-app>.vercel.app` — you should see the login page.

---

## 4. Wire up the frontend ↔ API URL

The frontend already reads `NEXT_PUBLIC_API_URL` at build time
(see `apps/web/lib/api.ts` and `apps/web/next.config.mjs`). When you set it in Vercel
before build, all `/api/*` calls are rewritten to your Render service.

---

## 5. Apply migrations (first run)

The Dockerfile runs `prisma migrate deploy` automatically before the server starts
(see `apps/api/Dockerfile`). Your Neon schema will be created on first deploy.

The demo company (Acme Inc) seeds automatically when `ENABLE_DEMO_SETUP=true`.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| API cold-starts slowly | Normal on Render free tier; used for demos only |
| "Cannot reach the API server" in UI | Check `NEXT_PUBLIC_API_URL` in Vercel points to `.../api` |
| CORS errors in browser | Ensure `WEB_URL` on Render matches your Vercel origin exactly |
| 500 on login after deploy | Ensure migrations ran; check Neon connection; `JWT_SECRET` set |
| Uploads lost on restart | Uploads are stored on the ephemeral container disk; use the seeded demo data |
| Neo4j connection fails | Verify `NEO4J_URI` uses `neo4j+s://` and credentials from Aura |

---

## 7. Environment variable reference

See `.env.production.example` in the repo root for the full list with explanations.
