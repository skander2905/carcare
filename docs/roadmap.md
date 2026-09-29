# CarCare — Delivery Roadmap

Twelve phases, each independently reviewable and each leaving the repository in
a working, tested state. Status is updated as phases land.

| Phase | Scope                                                                                                                     | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1     | **Foundation** — monorepo, NestJS + Next.js skeletons, config, logging, error handling, health probes, Prisma, Docker, CI | ✅ Done |
| 2     | **Authentication** — register, login, refresh rotation, logout, guards, rate limiting, protected routes                   | ✅ Done |
| 3     | **Vehicles** — CRUD, `VehicleMember` access control, odometer timeline                                                    | ✅ Done |
| 4     | **Expenses** — the cost ledger, categories, filtering, pagination                                                         | ✅ Done |
| 4b    | **Expense attachments** — optional receipt/invoice photo or PDF on an expense (pulled forward from Phase 8; no OCR)       | ✅ Done |
| 5     | **Fuel** — entries, full-to-full consumption engine, fuel analytics                                                       | ✅ Done |
| 6     | **Maintenance** — records, schedules, due/overdue engine                                                                  | ⬜ Next |
| 7     | **Reminders & jobs** — BullMQ queues, worker role, notifications                                                          | ⬜      |
| 8     | **Documents** — expiry tracking, vehicle-level documents (upload/download landed in 4b)                                   | ⬜      |
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

## Phase 3 — delivered

**Backend**

- `Vehicle`, `VehicleMember` and `OdometerReading`, with the indexes
  docs/database.md specifies. A `Transmission` enum was added alongside them;
  the field was specified without one.
- `VehicleAccessGuard` resolves `VehicleMember` on every vehicle-scoped route
  and attaches the role. Authorisation never reads `Vehicle.ownerId` (ADR-006),
  and services take the guard's resolved id rather than the raw parameter, so a
  query can only be scoped by something already authorised.
- **404, never 403**, for a vehicle the caller has no membership on — absent and
  "not yours" are deliberately indistinguishable. 403 is used only where the
  caller can already see the vehicle and merely lacks the role.
- Creating a vehicle writes its owner membership in the same transaction. A
  vehicle with no membership row is unreachable by design, and would still
  occupy the unique plate index.
- The odometer timeline enforces a **local** invariant: a reading must be at
  least its predecessor and at most its successor in time. The naive "must
  exceed current mileage" rule rejects backdating, which is the most common
  correction anyone makes.
- Concurrent readings are serialised with `SELECT … FOR UPDATE` on the vehicle
  row (ADR-010), and `Vehicle.currentOdometerKm` is updated in the same
  transaction as the reading it comes from.
- Money and engine size leave as fixed-width decimal **strings**.
  `Decimal.toString()` drops trailing zeros, so 38500.000 would otherwise ship
  as `"38500"` and the width would vary by value.

**Frontend**

- Vehicle list with an empty state, archive toggle, add form and detail page
- Odometer timeline with inline recording; the server's message names the
  reading in the way, so it is shown verbatim rather than reworded
- Money is grouped textually and never parsed to a float

**Deferred:** the sharing UI. `VehicleMember` supports `EDITOR` and `VIEWER`
today and the guard already honours them, but V1 creates only `OWNER` rows —
inviting someone is an insert plus an endpoint, not a migration.

## Phase 4 — delivered

**Backend**

- `Expense` with the specified indexes and a hand-written `CHECK (amount > 0)`.
  No `currency` column — ADR-016 wins over the entity list, which is corrected.
- `VehicleMembershipGuard` holds the membership check, the 404 policy and the
  role rule once. `VehicleAccessGuard` finds the vehicle in the route;
  `ExpenseAccessGuard` finds it through the expense, so `/expenses/:id` gets the
  same 404-not-403 behaviour. Fuel, maintenance and trip records will each be a
  subclass of a few lines.
- An expense carrying mileage writes its `EXPENSE` reading in the same
  transaction (`OdometerService.recordIn`), so a mileage that contradicts the
  timeline refuses the expense whole. Editing withdraws the old reading before
  validating the new one, and deleting re-derives `currentOdometerKm`.
- Filtering by category, inclusive date range and case-insensitive search;
  sorting from an allow-list with a stable `id` tie-break.
- `Idempotency-Key` on create (api.md §8).
- Fuel- and maintenance-derived rows refuse a direct edit or delete with `409`,
  enforced now so Phases 5 and 6 inherit it.
- 54 new unit tests and a 39-test integration suite.

**Frontend**

- `/vehicles/:id/expenses`: filters, debounced search, sort, pagination, inline
  add and edit, two-step delete. A recent-expenses card on the vehicle page.
- The form reuses its idempotency key while the payload is unchanged, so
  re-pressing "Add" after a lost response replays instead of double-counting —
  and takes a fresh key once anything is edited.
- Amounts in the user's display currency, never parsed to a float.

**Fixed during verification.**

- **Every browser submission was blocked by CORS.** `Idempotency-Key` was not
  in the allow-list, so the preflight succeeded and Chrome refused the request.
  Supertest does not enforce CORS, so the integration suite could not see it.
  The options now live in `common/http/cors.ts` with a spec.
- **Search treated `%` and `_` as wildcards.** Prisma's `contains` does not
  escape them, so "50%" matched "500 points". Escaped, and the test was checked
  by breaking the escape and watching it fail.
- **The concurrency test did not test the race.** Over a local socket the five
  "simultaneous" submits arrived in sequence, and the test still passed with
  the recovery branch disabled. `expenses.service.spec.ts` now forces that
  interleaving deterministically.

## Phase 4b — receipt attachments

Pulled forward from Phase 8 at Skander's request: an optional photo or PDF of
the receipt or invoice on any expense. Attach only; nothing reads the files.

**Backend**

- `Document` as specified in database.md, minus `maintenanceRecordId` until
  Phase 6 creates the table it points at.
- Presigned uploads straight to storage (ADR-009). The URL signs the exact
  content type and size, so the store refuses any other file — checked against
  MinIO, where a wrong size or type is a 403.
- Confirmation asks the store what arrived before a document counts: missing
  stays pending, a mismatch is discarded, a match is ready. Safe to repeat.
- Storage keys are random, never derived from the uploader's file name, and
  downloads carry a Content-Disposition that name cannot inject into.
- Deleting a document, its expense or its vehicle deletes the stored files,
  after the commit so a failed commit can never lose data.
- Storage is optional configuration: without credentials the API boots and
  the endpoints answer 503, so CI and a fresh clone need no bucket.

**Frontend**

- An optional Receipts picker when adding an expense, uploaded once the
  expense is saved; a Files panel on every row to view, remove or add more.
- `accept="image/*"` lets a phone offer its camera, without `capture`, so an
  emailed PDF can still be picked. HEIC is accepted.

**Fixed during verification.**

- **MinIO's images are gone from Docker Hub.** `minio/minio` and `minio/mc`
  now 404, which broke `docker compose up` for the whole stack. Compose uses
  Chainguard's rebuild of the same server. It has no shell and no `mc`, so the
  healthcheck is gone and the bucket is created by one retried `mc mb`.
- **Every upload would have failed on AWS S3.** The SDK adds a CRC32 checksum
  to presigned PUTs by default, computed at signing time over a body that does
  not exist yet. MinIO ignores it, so the upload succeeded — the URL gave it
  away. AWS verifies it. The signing client now adds checksums only when an
  operation requires them, and a unit test fails if one reappears.

**Not built:** a sweep for uploads never confirmed (Phase 7's job queue), and
thumbnails.

## Phase 5 — delivered

**Backend**

- `FuelEntry` with the specified indexes and CHECKs, plus positive price and
  total and "both coordinates or neither". Nullable `latitude`/`longitude` exist
  only to recognise a station on the next visit.
- A fill is three rows in one transaction: the entry, its ledger expense
  (category and source `FUEL`, "38.20 L petrol · Shell Lac 2") and its `FUEL`
  odometer reading. Editing moves all three; deleting removes them and purges
  receipts after commit. The ledger's 409 on derived rows, built in Phase 4, is
  now exercised for real.
- The full-to-full engine (ADR-012, ADR-018): a pure function in integer
  centilitres and millimes. Partial fills count toward their window, a missed
  fill abandons it, zero distance is "not enough data". Each full tank in the
  log carries its own window; `/analytics/consumption` sums a period by
  distance.
- Price per litre is derived when absent and refused when it contradicts total
  ÷ volume by more than 2%, with the message naming the right figure.
- `GET /vehicles/:id/fuel/suggestions` — what the form can prefill: the car's
  fuel, the last price per fuel type, stations logged within 300 m, recent
  stations and habitual whole amounts.
- 31 unit tests and a 29-test integration suite.

**Frontend**

- `/vehicles/:id/fuel`: economy panel (average, spend, price, cost per km, a
  per-tank trend line) and the fuel log with filters, edit, delete and receipts.
  A fuel card on the vehicle page.
- The form is built for a phone at the pump. Today, the car's fuel, the last
  price paid and a full tank are preselected; the station comes from the
  phone's location — history first, then OpenStreetMap from the browser, rounded
  to ~11 m; usual amounts and recent stations are chips. Litres and total are
  tied by the price, so either gives the other, and typing both lets the server
  derive the price instead. The mileage is shown as a hint, never guessed.

**Fixed during verification.**

- **Concurrent writes with a mileage deadlocked.** Five simultaneous submits of
  one fill returned three 500s. The insert took `FOR KEY SHARE` on the vehicle
  before the reading asked for `FOR UPDATE`. Phase 4's expense create had the
  same bug for expenses with a mileage — its race test never sent one. The lock
  is now taken first, and a test for each fails without the fix.
- **The price default skipped the calculation.** A last-price suggestion that
  arrived after litres were typed left the total blank; defaults now go through
  the same derivation as typed values.

**Not built:** unusual-consumption notifications (Phase 7), electric charging
in kWh, and fuel stations shared across a user's vehicles — the history match
is per vehicle, because that is the scope authorisation checks.

## Deferred by design

Not built, and why: reading receipts to pre-fill an expense (OCR — needs a vision service; 4b attaches files only), multi-currency conversion (needs historical rates and a
product decision), depreciation modelling, OBD-II, GPS tracking, push
notifications, vehicle sharing UI (the data model already supports it).
