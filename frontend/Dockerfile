# syntax=docker/dockerfile:1.7
#
# CarCare web image, built from Next.js `output: "standalone"`.

# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @carcare/frontend...

# ---------------------------------------------------------------------------
FROM deps AS build
# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be known
# here — it cannot be supplied at container start.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_APP_NAME=CarCare
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
COPY frontend ./frontend
RUN pnpm --filter @carcare/frontend run build

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone bundle already contains exactly the traced dependencies, so no
# node_modules copy and no second install are needed here.
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "frontend/server.js"]
