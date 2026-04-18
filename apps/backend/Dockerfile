# ============================================================================
# SmoothFS backend — production Dockerfile
#
# Build context must be the REPO ROOT so the Bun workspace and
# `@smoothfs/shared` resolve cleanly:
#
#   docker build -f apps/backend/Dockerfile -t smoothfs-backend .
#
# Railway sets the build context automatically when this Dockerfile is
# referenced via `apps/backend/railway.toml`.
# ============================================================================

FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Deps layer — copy ONLY manifests first so changes to source don't bust
# the install cache. Workspace manifests must be present before
# `bun install` so Bun can wire up the workspace graph.
#
# The root `package.json` declares workspaces = ["apps/*", "packages/*"].
# Bun expands those globs at install time and cross-checks the result
# against `bun.lock`. If ANY workspace manifest is missing, Bun considers
# the install graph "changed" and `--frozen-lockfile` aborts. So we copy
# every workspace's package.json here even though this image only USES
# the backend + shared — the frontend manifest is a few KB and keeps the
# lockfile integrity check happy.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock turbo.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Runtime image — bring the installed layout AS-IS, then overlay source.
#
# Bun uses ISOLATED workspace installs: each workspace has its own
# node_modules/ containing symlinks to its dependencies (including
# `@smoothfs/shared` under `apps/backend/node_modules/@smoothfs/`).
# If we copy only the root node_modules, the workspace symlinks are
# missing at runtime and Bun fails with:
#
#   error: Cannot find module '@smoothfs/shared' from '/app/apps/backend/src/index.ts'
#
# Copying the entire `/app` tree from the deps stage preserves the exact
# node_modules layout Bun created — root + per-workspace — without us
# having to enumerate every path. We then overlay the fresh source code
# from the build context on top, replacing the minimal manifest stubs
# with the real files.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app /app

# Overlay fresh source trees. The `COPY` order matters: overlays run
# after the deps-stage copy, so sources replace the stub package.jsons
# without disturbing the node_modules symlink graph.
COPY apps/backend ./apps/backend
COPY packages/shared ./packages/shared
# Shared tsconfig extended by every workspace. Bun doesn't need it for
# `bun run` (it executes TS directly, ignoring tsconfig compilerOptions),
# but anything that invokes `tsc` against this image — future tooling,
# `bun run typecheck`, IDE introspection of the container — would fail
# without it.
COPY tsconfig.base.json ./

WORKDIR /app/apps/backend
EXPOSE 3000

# The BullMQ cleanup worker + cache are opt-in via env, so enabling them in
# the container is a deploy-time decision, not a build-time one.
CMD ["bun", "run", "src/index.ts"]
