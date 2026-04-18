# Deploying SmoothFS to Railway

End-to-end guide to deploy.
You'll end up with three services in one Railway project:

```
smoothfs (project)
├── backend        ← Bun + Elysia
├── frontend       ← Vue SPA served by nginx
├── Postgres (addon)
└── Redis (addon)
```

The repository already ships everything Railway needs:

- `apps/backend/Dockerfile`     — monorepo-aware Bun image
- `apps/backend/railway.toml`   — build + pre-deploy migrate/seed + healthcheck
- `apps/frontend/Dockerfile`    — Vite build → nginx:alpine runtime
- `apps/frontend/nginx.conf`    — SPA history fallback + immutable asset cache
- `apps/frontend/railway.toml`  — build + healthcheck (`/healthz`)
- `.dockerignore`               — excludes tests, coverage, turbo caches

## 1. Prerequisites

1. A Railway account — sign up at [railway.com](https://railway.com).
2. The repo pushed to GitHub (Railway deploys from GitHub).
3. (Optional) The Railway CLI: `npm i -g @railway/cli` — handy for tailing
   logs without opening the dashboard.

## 2. Create the project

1. From the Railway dashboard, **New Project → Deploy from GitHub repo** →
   pick `smooth-fs`.
2. Railway will start importing the repo. Cancel the automatic service
   detection — we'll wire two services explicitly.

## 3. Add Postgres + Redis

1. **Add → Database → PostgreSQL**. Railway provisions a managed Postgres
   and exposes `DATABASE_URL` as a variable reference (e.g.
   `${{ Postgres.DATABASE_URL }}`).
2. **Add → Database → Redis**. Same thing: `REDIS_URL` is exposed as
   `${{ Redis.REDIS_URL }}`.

Leave both running; the backend service will reference them via variable
interpolation in step 4.

## 4. Create the backend service

1. **Add → GitHub Repo → smooth-fs**. Name the service `backend`.
2. **Settings → Source**:
   - **Root Directory**: **leave empty** (not `apps/backend`). The
     Dockerfile copies `packages/shared` from outside `apps/backend/`, so
     the Docker build context MUST be the repo root. Setting Root
     Directory here narrows the context and the build fails with
     `COPY packages/shared ...: not found`.
   - **Watch Paths** _(optional but recommended to avoid unrelated rebuilds)_:
     ```
     apps/backend/**
     packages/shared/**
     bun.lock
     package.json
     ```
3. **Settings → Build**: already configured by `apps/backend/railway.toml` —
   Dockerfile builder pointed at `apps/backend/Dockerfile` (a path
   relative to the repo root, which is why step 2 mattered).
4. **Variables** (click → Raw Editor, paste):

   ```env
   NODE_ENV=production
   LOG_LEVEL=info
   DATABASE_URL=${{ Postgres.DATABASE_URL }}
   REDIS_URL=${{ Redis.REDIS_URL }}
   PORT=3000
   ENABLE_CACHE=true
   ENABLE_CLEANUP_WORKER=true
   FRONTEND_ORIGIN=https://${{ frontend.RAILWAY_PUBLIC_DOMAIN }}
   ```

   The `${{ ... }}` references let Railway rewrite values automatically when
   the referenced service/addon changes — so rotating the Postgres password
   won't require a redeploy edit.

5. **Networking → Generate Domain**. Copy the resulting URL
   (`https://backend-production-xxxx.up.railway.app`). You'll need it for
   the frontend.
6. **Deploy**. Watch the logs; you should see:
   - `pre-deploy: migrate` (applies Drizzle migrations)
   - `pre-deploy: seed`    (TRUNCATE + re-seed the fixture)
   - `smoothfs backend listening { port: 3000 }`
   - Railway healthcheck turning green on `GET /health`.

## 5. Create the frontend service

1. **Add → GitHub Repo → smooth-fs**. Name the service `frontend`.
2. **Settings → Source**:
   - **Root Directory**: **leave empty** (same reason as the backend —
     the Dockerfile needs `packages/shared` outside `apps/frontend/`).
   - **Watch Paths** _(optional)_:
     ```
     apps/frontend/**
     packages/shared/**
     bun.lock
     package.json
     ```
3. **Variables**:

   ```env
   VITE_API_BASE_URL=https://${{ backend.RAILWAY_PUBLIC_DOMAIN }}
   VITE_DEMO_MODE=true
   ```

   Vite inlines `VITE_*` vars at **build** time, and Railway forwards
   service variables to `docker build --build-arg` when they match names
   declared as `ARG` in the Dockerfile. That's exactly how our
   `apps/frontend/Dockerfile` consumes them.

4. **Networking → Generate Domain**.
5. **Deploy**. Logs will show `nginx` starting and the healthcheck on
   `/healthz` turning green.

## 6. Close the CORS loop

The backend was deployed with `FRONTEND_ORIGIN` set to a variable reference
that only resolves AFTER the frontend service exists. Trigger a redeploy of
the backend:

- Backend service → **Deployments → ⋯ → Redeploy**.

Once it's back up, open the frontend URL. You should land on the Explorer
shell, with the demo banner visible at the top.

## 7. Smoke checks

- `https://<backend>.up.railway.app/health` returns
  `{"data":{"status":"ok","db":"ok","redis":"ok"}, ...}`
- `https://<frontend>.up.railway.app/healthz` returns `ok`
- The tree expands, folder selection updates the right panel,
  search works (try typing `deep`), and the breadcrumb navigates.

## 8. Link from the README

Edit the "Try it live" section at the top of `README.md` to point at the
frontend URL you generated. That's the single biggest UX win for anyone
reviewing this project.

## Custom domain

Railway gives every service a free `*.up.railway.app` URL, but a real
domain (e.g. `smoothfs.cloud`) makes the demo look production-grade and
lets you keep the same URL across redeploys.

### Strategy: subdomain split

| Service  | URL                           |
| -------- | ----------------------------- |
| Frontend | `https://smoothfs.cloud`      |
| Backend  | `https://api.smoothfs.cloud`  |

This keeps both services on the same registrable domain (so browser
cookies/CORS treat them as same-site for most purposes) while giving each
its own TLS cert and routing. Path-based routing (`/api` under the apex)
would require a reverse proxy in front of both services — needless moving
parts for a demo.

### DNS records

Railway shows a CNAME target for each custom domain you add (under the
service's **Networking → Custom Domain** tab). Point your DNS at those
targets:

| Record type         | Host  | Value                           |
| ------------------- | ----- | ------------------------------- |
| CNAME               | `api` | `<backend>.up.railway.app`      |
| ALIAS / ANAME / CNAME-flattening | `@` (apex) | `<frontend>.up.railway.app` |
| CNAME (optional)    | `www` | `smoothfs.cloud` (for `www` → apex redirect) |

> A plain `CNAME` is illegal at the zone apex per RFC. Use your DNS
> provider's ALIAS/ANAME equivalent, or (easiest) park the domain on
> Cloudflare — its CNAME flattening makes apex CNAMEs "just work".

TLS is automatic: Railway issues a Let's Encrypt cert once DNS resolves,
usually within a minute.

### Environment variable updates

After the domain is live, update two variables and redeploy the affected
services:

| Service  | Variable              | New value                        | Redeploy needed? |
| -------- | --------------------- | -------------------------------- | ---------------- |
| Backend  | `FRONTEND_ORIGIN`     | `https://smoothfs.cloud`         | Yes (env change) |
| Frontend | `VITE_API_BASE_URL`   | `https://api.smoothfs.cloud`     | **Yes — rebuild.** Vite inlines `VITE_*` vars at build time. |

### Keep `www` from breaking CORS

`https://smoothfs.cloud` and `https://www.smoothfs.cloud` are different
origins. The backend's `FRONTEND_ORIGIN` is a single string, so pick one
canonical host and 301-redirect the other to it at the DNS / CDN layer
(Cloudflare Page Rules, Netlify redirects, etc.). Apex-as-canonical is the
most common choice.

## Routine operations

| Task                                | Where |
| ----------------------------------- | ----- |
| Tail backend logs                   | Backend service → Logs (or `railway logs -s backend`) |
| Re-run migrations only              | Backend → Variables → toggle any → Redeploy. Pre-deploy re-runs. |
| Wipe and re-seed the demo database  | Redeploy the backend (pre-deploy always TRUNCATEs + re-seeds). |
| Bump Bun version                    | Edit the `FROM oven/bun:1.3-alpine` base in both Dockerfiles. |
| Add a new backend env var           | `apps/backend/src/env.ts` (Zod) → Variables on Railway. Both need it — the schema fails fast on missing values. |

## Troubleshooting

**Build fails with `COPY packages/shared ...: not found` (or similar).**
The Railway service has **Root Directory** set to `apps/backend` (or
`apps/frontend`). That tells Railway to send only that subdirectory as
the Docker build context, which chops off `packages/shared` and the root
`package.json`. Fix: Service → Settings → Source → **clear Root
Directory** (leave it empty). Use **Watch Paths** instead if you want to
avoid rebuilds on unrelated changes.

**Build fails with `cannot find package @smoothfs/shared`.** Same root
cause as above — the workspace root isn't in the build context. Clear
Root Directory.

**Backend fails with `deploy.preDeployCommand: Array must contain at
most 1 element(s)`.** Railway's config schema only accepts a single
string for `preDeployCommand`. Chain multiple commands with `&&` inside
one string (which is what our `railway.toml` now does).

**Frontend loads but all API calls hit `http://localhost:3000`.** You
deployed with `VITE_API_BASE_URL` unset or wrong. Vite inlines the value at
**build** time — set the variable and redeploy the frontend service (a
restart is not enough).

**CORS errors in the browser console.** The backend's `FRONTEND_ORIGIN` is
stale or missing. Check `https://<backend>/health` works, then open the
backend service → Variables → confirm `FRONTEND_ORIGIN` matches the exact
URL you're hitting (including scheme, no trailing slash). Redeploy after
editing.

**`/health` reports `redis: down`.** Variable reference didn't resolve.
Double-check the backend service has `REDIS_URL=${{ Redis.REDIS_URL }}`
(not a hand-pasted URL), and that the Redis addon is attached to the same
Railway project.
