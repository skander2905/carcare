# CarCare — Delivery Roadmap

Twelve phases, each independently reviewable and each leaving the repository in
a working, tested state. Status is updated as phases land.

| Phase | Scope                                                                                                                     | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1     | **Foundation** — monorepo, NestJS + Next.js skeletons, config, logging, error handling, health probes, Prisma, Docker, CI | ✅ Done |
| 2     | **Authentication** — register, login, refresh rotation, logout, guards, rate limiting, protected routes                   | ⬜ Next |
| 3     | **Vehicles** — CRUD, `VehicleMember` access control, odometer timeline                                                    | ⬜      |
| 4     | **Expenses** — the cost ledger, categories, filtering, pagination                                                         | ⬜      |
| 5     | **Fuel** — entries, full-to-full consumption engine, fuel analytics                                                       | ⬜      |
| 6     | **Maintenance** — records, schedules, due/overdue engine                                                                  | ⬜      |
| 7     | **Reminders & jobs** — BullMQ queues, worker role, notifications                                                          | ⬜      |
| 8     | **Documents** — presigned S3 upload/download, expiry tracking                                                             | ⬜      |
| 9     | **Analytics** — dashboard, charts, cost/km, total cost of ownership                                                       | ⬜      |
| 10    | **Trips** — trip log and estimated trip cost                                                                              | ⬜      |
| 11    | **Testing** — integration coverage, Playwright E2E journeys                                                               | ⬜      |
| 12    | **Production** — image hardening, deployment, monitoring, docs                                                            | ⬜      |

Testing is not deferred to Phase 11. Every phase ships its own unit and
integration tests; Phase 11 adds the end-to-end journeys and closes coverage
gaps across the whole system.

## Phase 1 — delivered

**Backend**

- NestJS 12 (ESM) with a modular layout and enforced layering rules
- Zod-validated configuration; the process refuses to boot on a bad value
- Structured logging (Pino) with request correlation and secret redaction
- One global exception filter producing a uniform error envelope
- Prisma 7 + PostgreSQL with a driver adapter; `User` and `RefreshToken`
  modelled, initial migration generated
- Redis client with lifecycle management
- Liveness / readiness / summary health probes, with Redis reported as
  _degraded_ rather than _down_ so a Redis outage cannot evict healthy replicas
- Swagger/OpenAPI, disabled in production
- 28 unit tests, including a DI smoke test

**Frontend**

- Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui (radix-nova)
- Light/dark/system theming with no hydration mismatch
- TanStack Query with a per-request client and error-aware retry policy
- Typed API client with a single `ApiError` type and a pluggable token provider
- Landing page with a live system-status card exercising loading, error and
  loaded states
- 19 unit tests

**Infrastructure**

- Multi-stage Dockerfiles for both services, non-root, health-checked
- Compose stack: PostgreSQL, Redis, MinIO, a one-shot migration service, API, web
- CI: format, lint, typecheck, unit tests, build, integration tests against real
  PostgreSQL and Redis, and a Docker build gate
- Release workflow publishing images to GHCR, with deployment gated on config
- Conventional Commits enforced via commitlint + husky

## Deferred by design

Not built, and why: multi-currency conversion (needs historical rates and a
product decision), depreciation modelling, OCR, OBD-II, GPS tracking, push
notifications, vehicle sharing UI (the data model already supports it).
