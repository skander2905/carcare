# CarCare

**A personal vehicle management platform that answers one question honestly:
_how much is my car actually costing me?_**

CarCare turns fuel receipts, service invoices, insurance renewals and odometer
readings into a true cost per kilometre — and tells you what needs attention
next.

```
Next.js 16 · React 19 · Tailwind 4 · shadcn/ui
NestJS 12 · Prisma 7 · PostgreSQL 17 · Redis 8 · BullMQ
Docker · GitHub Actions
```

---

## Why this project exists

Most vehicle trackers are data-entry tools: you put numbers in and get the same
numbers back in a list. CarCare is built around the derived numbers — cost per
kilometre, true fuel consumption, total cost of ownership — which is where the
interesting engineering lives:

- **Fuel consumption is computed full-to-full**, accounting for partial fills
  and missed logs, rather than the naive "litres ÷ distance since last fill"
  that silently produces wrong figures.
- **Cost aggregation happens in SQL**, so a vehicle with five years of history
  returns ~60 rows to draw a chart, not thousands of records.
- **Money is exact decimal** end to end. TND has three decimal places, and a
  float would round every total.
- **Authorisation is enforced server-side on every request**, resolved through a
  membership table rather than an inline owner check.

Design rationale, including what was rejected and why, is in
[`docs/decisions.md`](./docs/decisions.md).

---

## Features

| Area            | What it does                                                                        |
| --------------- | ----------------------------------------------------------------------------------- |
| **Vehicles**    | Multiple vehicles per user, full specification, odometer timeline                   |
| **Fuel**        | Fill-ups, full-to-full consumption, cost per kilometre, station history             |
| **Expenses**    | One ledger for every cost — insurance, tyres, tolls, parking, repairs               |
| **Maintenance** | Service records plus schedules by distance, time, or both                           |
| **Reminders**   | Background workers watch insurance expiry, inspections, upcoming services           |
| **Documents**   | Registration, insurance and invoices in S3-compatible storage, with expiry tracking |
| **Trips**       | Optional trip log with estimated fuel cost from real consumption data               |
| **Analytics**   | Monthly and yearly trends, category breakdown, total cost of ownership              |

Delivery status per feature: [`docs/roadmap.md`](./docs/roadmap.md).

---

## Architecture at a glance

```
 Browser ──► Next.js (App Router, TanStack Query)
                │  REST/JSON · bearer access token · httpOnly refresh cookie
                ▼
            NestJS API  ──  thin controllers → services → repositories
                │                 pure domain functions (no I/O)
      ┌─────────┼─────────┬──────────────┐
      ▼         ▼         ▼              ▼
  PostgreSQL  Redis   S3 / MinIO    BullMQ worker
  (truth)    (queues) (documents)   (same image, APP_ROLE=worker)
```

The API is stateless — no sessions, no local disk — so it scales horizontally
with no coordination. Full description in
[`docs/architecture.md`](./docs/architecture.md).

### Repository layout

```
carcare/
├── backend/          NestJS API + queue worker
│   ├── prisma/       schema and migrations
│   └── src/
│       ├── common/   filters, logging, shared utilities
│       ├── config/   Zod-validated configuration
│       ├── health/   liveness / readiness probes
│       ├── prisma/   database access
│       └── redis/    cache and queue connection
├── frontend/         Next.js web application
│   └── src/
│       ├── app/      routes (App Router)
│       ├── components/  ui/ (shadcn), layout, providers
│       ├── features/ feature-scoped hooks and components
│       └── lib/      API client, environment
├── docs/             architecture, database, api, decisions, roadmap
└── docker-compose.yml
```

---

## Getting started

### Requirements

- **Node.js 20.11+** (24 recommended)
- **pnpm 10+** — `corepack enable && corepack prepare pnpm@10.11.0 --activate`
- **Docker + Docker Compose** — for PostgreSQL, Redis and MinIO

### Option A — everything in Docker

```bash
cp .env.example .env
docker compose up --build
```

Web app on <http://localhost:3000>, API on <http://localhost:3001>,
API docs on <http://localhost:3001/api/docs>.

Migrations run automatically as a one-shot `migrate` service before the API
starts.

### Option B — services in Docker, apps on the host

Better for day-to-day development: hot reload on both sides.

```bash
cp .env.example .env
docker compose up -d db redis minio          # infrastructure only
pnpm install
pnpm --filter @carcare/backend exec prisma migrate deploy
pnpm --filter @carcare/backend exec prisma generate
pnpm dev                                      # runs both apps in parallel
```

> The Prisma client is generated code and is gitignored. Run `prisma generate`
> after cloning and after any schema change, or the backend will not compile.

---

## Environment variables

Copy `.env.example` to `.env`. Variables consumed by the API are validated at
boot by [`backend/src/config/env.schema.ts`](./backend/src/config/env.schema.ts)
— an invalid value stops the process with a readable message listing **every**
problem, rather than failing later with an `undefined`.

| Variable              | Default                 | Purpose                                              |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| `NODE_ENV`            | `development`           | Runtime mode; forces Swagger off in production       |
| `APP_ROLE`            | `api`                   | `api` \| `worker` \| `all` — one image, two roles    |
| `BACKEND_PORT`        | `3001`                  | API port                                             |
| `DATABASE_URL`        | —                       | **Required.** PostgreSQL connection string           |
| `REDIS_URL`           | —                       | **Required.** Redis connection string                |
| `CORS_ORIGINS`        | `http://localhost:3000` | Comma-separated allowed origins                      |
| `LOG_LEVEL`           | `info`                  | `fatal`…`trace`, or `silent`                         |
| `LOG_PRETTY`          | `false`                 | Human-readable logs; development only                |
| `TRUST_PROXY`         | `false`                 | Enable behind a load balancer so client IPs are real |
| `SWAGGER_ENABLED`     | `true`                  | Serve OpenAPI docs (never in production)             |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API **origin**; inlined at build time                |

`NEXT_PUBLIC_*` values are baked into the frontend bundle at build time, so
changing them requires rebuilding the frontend image — not just restarting it.

---

## Database

```bash
pnpm --filter @carcare/backend exec prisma migrate dev --name <change>  # create
pnpm --filter @carcare/backend exec prisma migrate deploy               # apply
pnpm --filter @carcare/backend exec prisma studio                       # browse
pnpm --filter @carcare/backend run prisma:seed                          # seed
```

The schema grows one migration per phase. Migrations are written to be
backwards-compatible with the running version, so a rollback never has to undo
one. Model and indexing rationale: [`docs/database.md`](./docs/database.md).

---

## Testing

```bash
pnpm test                                  # unit tests, both workspaces
pnpm --filter @carcare/backend test:cov    # with coverage
pnpm test:e2e                              # integration — needs db + redis running
```

Three layers, each with a distinct job:

- **Unit** — pure domain logic with no I/O: consumption maths, cost per
  kilometre, maintenance-due calculation, configuration parsing.
- **Integration** — the real Nest application against a real PostgreSQL and
  Redis, exercising migrations, constraints and authorisation. An in-memory fake
  cannot test any of those, which is the whole point.
- **E2E** (Phase 11) — Playwright over the real user journeys.

Integration tests need infrastructure:

```bash
docker compose up -d db redis
pnpm --filter @carcare/backend exec prisma migrate deploy
pnpm test:e2e
```

---

## Code quality

```bash
pnpm lint          # ESLint, type-aware rules, zero warnings tolerated
pnpm typecheck     # tsc --noEmit
pnpm format        # Prettier
```

Type-aware linting is on, including `no-floating-promises` — a dropped promise
in a request handler or a queue processor silently loses work and swallows
errors, which is the single highest-value rule in a Nest + Prisma codebase.
`any` requires a visible, reviewable `eslint-disable` comment.

Commits follow [Conventional Commits](https://www.conventionalcommits.org),
enforced by commitlint through a husky `commit-msg` hook.

---

## CI/CD

**On every pull request** ([`ci.yml`](./.github/workflows/ci.yml)):
formatting → lint → typecheck → unit tests → build, then integration tests
against real PostgreSQL and Redis service containers, then a Docker build gate
so a broken Dockerfile fails the PR rather than the deploy.

**On `main`** ([`release.yml`](./.github/workflows/release.yml)): builds and
publishes both images to GHCR tagged by commit SHA. The deploy job is gated on a
`DEPLOY_WEBHOOK_URL` secret, so the pipeline is green from day one and becomes a
real deployment the moment that secret exists.

---

## Observability

- **Structured JSON logs** (Pino) with a request id on every line, taken from an
  inbound `X-Request-Id` when a proxy supplies one and echoed on the response.
- **Redaction by default** — credentials, cookies and tokens are stripped before
  serialisation rather than trusted not to appear.
- **Health probes** for the three questions an orchestrator actually asks:

| Endpoint        | Question                   | Touches dependencies                                  |
| --------------- | -------------------------- | ----------------------------------------------------- |
| `/health/live`  | Is the process wedged?     | No — so a database outage cannot cause a restart loop |
| `/health/ready` | Should traffic route here? | Yes                                                   |
| `/health`       | Human-facing summary       | Yes                                                   |

Redis reports as **degraded**, not down: losing it costs background jobs and
rate limiting, but reads and writes still work. Failing readiness would evict
healthy replicas and turn a partial outage into a total one.

---

## Documentation

| Document                                         | Contents                                                 |
| ------------------------------------------------ | -------------------------------------------------------- |
| [`docs/architecture.md`](./docs/architecture.md) | System shape, layering rules, request lifecycle, scaling |
| [`docs/database.md`](./docs/database.md)         | Full ERD, conventions, indexing rationale                |
| [`docs/api.md`](./docs/api.md)                   | REST conventions, auth flow, error envelope, endpoints   |
| [`docs/decisions.md`](./docs/decisions.md)       | Architecture decision records with rejected alternatives |
| [`docs/roadmap.md`](./docs/roadmap.md)           | Phase-by-phase delivery plan and status                  |

---

## Licence

MIT
