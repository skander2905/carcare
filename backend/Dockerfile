# syntax=docker/dockerfile:1.7
#
# CarCare API image.
#
# Debian slim rather than Alpine on purpose: the image carries native modules
# (@node-rs/argon2, the Prisma driver adapter) and glibc prebuilds are the
# best-supported path. The size difference does not justify the risk.

# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies — cached independently of source, so editing a .ts file does not
# invalidate the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM deps AS build
COPY backend ./backend
RUN pnpm --filter @carcare/backend exec prisma generate \
 && pnpm --filter @carcare/backend run build

# ---------------------------------------------------------------------------
# Re-resolve with --prod so devDependencies (vitest, eslint, the TypeScript
# compiler) never reach the runtime image.
#
# --ignore-scripts because this install re-runs the root `prepare` script, and
# `prepare` is `husky` — which --prod has just pruned. Nothing in the runtime
# dependency tree needs a build script here; the image is already compiled.
FROM build AS prune
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    APP_ROLE=api \
    PORT=3001

# pnpm's layout symlinks package directories into a shared store, so both
# node_modules trees must be copied for those links to resolve.
COPY --from=prune --chown=node:node /app/node_modules ./node_modules
COPY --from=prune --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/prisma.config.ts ./backend/prisma.config.ts
# Migrations ship with the image so `prisma migrate deploy` is runnable at release time.
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma

USER node
WORKDIR /app/backend
EXPOSE 3001

# Node 24 has a global fetch, so the probe needs no extra package in the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form: node becomes PID 1 and receives SIGTERM directly, which is what
# lets Nest run its shutdown hooks and drain connections cleanly.
CMD ["node", "dist/main.js"]
