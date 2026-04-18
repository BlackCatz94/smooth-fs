# ============================================================================
# SmoothFS frontend — production Dockerfile
#
# Two stages:
#   1) builder — install workspace deps and run `vite build`. `VITE_*` vars
#      are compiled in at build time, so they MUST arrive via --build-arg.
#   2) runner  — nginx:alpine serving `dist/` with SPA history fallback.
#
# Build from the REPO ROOT:
#
#   docker build -f apps/frontend/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.com \
#     --build-arg VITE_DEMO_MODE=true \
#     -t smoothfs-frontend .
#
# Railway auto-populates build args from the service's variables when the
# variable name matches.
# ============================================================================

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

# Copy EVERY workspace manifest before installing. The root package.json
# declares workspaces = ["apps/*", "packages/*"]; Bun expands the glob
# and cross-checks the result against `bun.lock`. Omitting the backend's
# package.json here makes Bun think the graph changed and
# `--frozen-lockfile` aborts with "lockfile had changes".
COPY package.json bun.lock turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# Shared tsconfig lives at the repo root and is referenced by every
# workspace via `"extends": "../../tsconfig.base.json"`. Without it in
# the build layer, `vue-tsc --noEmit` silently falls back to
# TypeScript's default `target: ES3` and then chokes on `#private`
# fields (TS18028) used by dependencies like Pino, BullMQ, etc.
COPY tsconfig.base.json ./

COPY apps/frontend apps/frontend
COPY packages/shared packages/shared

# Vite inlines these at build time. We declare them as build args so
# `VITE_API_BASE_URL` can point at the backend Railway URL per environment
# (staging vs prod) without rebuilding the image by hand.
ARG VITE_API_BASE_URL
ARG VITE_DEMO_MODE
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}

WORKDIR /app/apps/frontend
RUN bun run build

# ---------------------------------------------------------------------------
# Runtime: nginx with SPA history fallback + gzip + sane cache headers.
#
# Railway injects `PORT` at runtime and expects the container to listen on
# it; a hardcoded `listen 80` fails every healthcheck with "service
# unavailable". We drop the config in `/etc/nginx/templates/` with a
# `.template` suffix — the `nginx:alpine` entrypoint runs that through
# `envsubst` before launching nginx, so `${PORT}` gets interpolated at
# container start. Provide a sensible default here for local `docker run`
# without `-e PORT=...`, but Railway always overrides.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner
ENV PORT=8080

# Cap worker_processes. The default is `auto` = one worker per host CPU;
# on Railway's bigger nodes that's 48+ processes, all racing to bind
# sockets at container start. For a static-asset SPA server one or two
# workers is plenty and the container becomes healthy far faster — which
# matters because Railway starts probing `/healthz` the moment the
# container starts.
RUN sed -i 's/^worker_processes\s*auto;/worker_processes 2;/' /etc/nginx/nginx.conf

COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
