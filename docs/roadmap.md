# CarCare — Delivery Roadmap

Twelve phases, each independently reviewable and each leaving the repository in
a working, tested state. Status is updated as phases land.

| Phase | Scope                                                                                                                     | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1     | **Foundation** — monorepo, NestJS + Next.js skeletons, config, logging, error handling, health probes, Prisma, Docker, CI | ✅ Done |
| 2     | **Authentication** — register, login, refresh rotation, logout, guards, rate limiting, protected routes                   | ✅ Done |
| 3     | **Vehicles** — CRUD, `VehicleMember` access control, odometer timeline                                                    | ⬜ Next |
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

## Phase 2 — delivered

**Backend**

- Argon2id password hashing (OWASP parameters), with a dummy-hash verification
  on the "no such account" path so login timing cannot be used to discover
  which addresses are registered
- Short-lived access JWTs (15 min, HS256) with `issuer`/`audience` verified, not
  merely set
- Opaque refresh tokens: 256 bits of entropy, SHA-256 at rest, `httpOnly` +
  `SameSite=Lax` cookie scoped to `/api/v1/auth`
- Rotation on every refresh, with family-based replay detection — presenting a
  spent token revokes the whole family (ADR-005). The revoke-and-replace is one
  transaction with a conditional update, so two concurrent refreshes cannot both
  mint a successor
- A short reuse-grace window so two tabs refreshing at once is not mistaken for
  a theft (ADR-010)
- `JwtAuthGuard` registered globally: every route is protected unless it carries
  `@Public()`, so a new endpoint is private by omission rather than by memory
- Redis sliding-window rate limiter in Lua (ADR-008), per-IP **and** per-account,
  failing open if Redis is down
- `GET /auth/me`, `GET /users/me`, `PATCH /users/me`; `email` and `role` are not
  patchable
- 61 new unit tests, plus 45 integration tests run against real PostgreSQL and
  Redis: the full HTTP surface, replay detection, the reuse-grace window and the
  Lua rate limiter

**Frontend**

- Access token held in a module variable — never `localStorage`, never a
  readable cookie
- Session recovery on cold load via one `/auth/refresh`, and refresh-and-retry
  once on any 401
- All refreshes funnelled through a single in-flight promise, so concurrent
  queries cannot trigger two rotations and trip replay detection (ADR-010)
- Login and registration with react-hook-form + Zod mirroring the server's rules
- `(app)` route group gated by `RequireAuth`, with `?next=` preserved and
  validated against open redirects
- Account menu with sign-out; 30 new unit tests

**Fixed during verification.** Two defects that a green unit suite had not seen:

- **Logging out did not stick.** The reuse-grace window treated any recently
  revoked token as a rotation, so a token spent in the previous ten seconds
  could mint a fresh session for an account that had just signed out — and could
  likewise revive a family killed by replay detection. The grace path now also
  requires the family to still hold a live token, which is what actually
  distinguishes a concurrent refresh from an ended session. The integration
  suite ran with the grace at zero, where the faulty branch is unreachable;
  `session-grace.e2e-spec.ts` now covers it at a realistic setting.
- **`.env` was never read** by the app, the Prisma CLI or the e2e setup — all
  three resolved it against the working directory (`backend/`) while the
  workspace keeps one file at the repository root. Dating from Phase 1, it made
  running anything outside Docker impossible. `src/config/env-files.ts` now
  resolves the paths from the package's own location; real environment variables
  still take precedence, which is why Docker and CI never surfaced it.

The integration suites also refuse to run against a database whose name does not
contain `test`, since they truncate tables between tests.

**Not built, deliberately:** password reset and email verification (both need an
email provider, which arrives with the notification adapters in Phase 7),
and the vehicle-sharing invite flow (Phase 3's data model, not this one's).

## Phase 2b — sign in with Google

Added after Phase 2 landed, on the same session machinery.

- Authorization-code flow with PKCE, run server-side; `state` and the verifier
  live in Redis and are consumed on use, so a callback URL works exactly once
- ID tokens verified against Google's JWKS — signature, issuer, audience and
  expiry, with `email_verified` required
- A provider sign-in produces the **same** session a password login does: same
  access token, same rotating family, same cookie. No token ever appears in a
  URL
- A matching email address does **not** link accounts; linking happens only from
  an authenticated session (ADR-017)
- Identity is the provider's `sub`, not the email
- Disconnecting the last credential is refused
- Providers are optional: with no credentials configured, `/auth/providers`
  returns `[]` and no button renders
- `/settings` added, so the "connect it from settings" refusal is actionable —
  and `PATCH /users/me` finally has a UI
- Apple is not built. The provider layer is an interface with one
  implementation, so Apple is a second file plus its ES256 client-secret
  signing — but it needs a paid developer account and an HTTPS redirect URI,
  which localhost cannot satisfy
- 33 new unit tests and an 18-test integration suite that drives the whole HTTP
  flow through a stub provider, so it needs neither credentials nor a network

## Deferred by design

Not built, and why: multi-currency conversion (needs historical rates and a
product decision), depreciation modelling, OCR, OBD-II, GPS tracking, push
notifications, vehicle sharing UI (the data model already supports it).
