# HackTrackr Backend

Express + TypeScript backend for hackathon auto-discovery and URL extraction.
Deployed on **Railway** (free tier).

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment variables

Copy the example and fill in your values:
```bash
cp .env.example .env
```

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase URL (same as mobile app) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service role** key (from Dashboard → Settings → API) |
| `OLLAMA_URL` | `https://ollama.com/api` |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` |
| `OLLAMA_API_KEY` | Your Ollama cloud key |
| `CRON_SECRET` | Any random string — used to secure manual sync trigger |

### 3. Run locally (dev)
```bash
npm run dev
```

### 4. Run a manual sync
```bash
npm run sync
```

### 5. Test URL extraction
```bash
curl -X POST http://localhost:3001/api/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://devfolio.co/hackathons/encode-ai-2025"}'
```

---

## Deploy to Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Point to this `backend/` folder (set root directory to `backend`)
3. Add environment variables in Railway Dashboard
4. Railway auto-builds and runs `npm run build && npm start`
5. Copy the public Railway URL → paste into mobile `.env` as `EXPO_PUBLIC_BACKEND_URL`

---

## API Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/api/extract` | Fetch URL, AI-extract hackathon details |
| `POST` | `/api/save` | Upsert a NormalizedHackathon into Supabase |
| `POST` | `/api/sync` | Trigger full scraper run (requires `x-cron-secret` header) |

---

## Adding More Scrapers

1. Create `src/scrapers/<platform>.scraper.ts`
2. Export `async function scrape<Platform>(): Promise<NormalizedHackathon[]>`
3. Import and call it in `src/jobs/syncHackathons.ts`
