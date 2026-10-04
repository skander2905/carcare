# CarCare — Delivery Roadmap

Twelve phases, each independently reviewable and each leaving the repository in
a working, tested state. Status is updated as phases land.

| Phase | Scope                                                                                                                     | Status   |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1     | **Foundation** — monorepo, NestJS + Next.js skeletons, config, logging, error handling, health probes, Prisma, Docker, CI | ✅ Done  |
| 2     | **Authentication** — register, login, refresh rotation, logout, guards, rate limiting, protected routes                   | ✅ Done  |
| 3     | **Vehicles** — CRUD, `VehicleMember` access control, odometer timeline                                                    | ✅ Done  |
| 4     | **Expenses** — the cost ledger, categories, filtering, pagination                                                         | ✅ Done  |
| 4b    | **Expense attachments** — optional receipt/invoice photo or PDF on an expense (pulled forward from Phase 8; no OCR)       | ✅ Done  |
| 5     | **Fuel** — entries, full-to-full consumption engine, fuel analytics                                                       | ✅ Done  |
| 6     | **Maintenance** — records, schedules, due/overdue engine                                                                  | ✅ Done  |
| 7     | **Reminders & jobs** — BullMQ queues, worker role, notifications, account emails                                          | ✅ Done  |
| 7b    | **Easier mileage entry** — rethink how the odometer is entered across the forms (requested 2026-10-03; to be scoped)      | ⬜ Next  |
| 8     | **Car papers** — files on reminders, the car's own papers; dates stay on reminders (cut down, ADR-023)                    | ✅ Done  |
| 9     | **Analytics** — dashboard, charts, cost/km, total cost of ownership                                                       | ⬜       |
| 10    | **Trips** — trip log and estimated trip cost                                                                              | ⬜ Next  |
| 11    | **Testing** — integration coverage, Playwright E2E journeys                                                               | ⬜       |
| 12    | **Going online** — Vercel + Render + Neon + B2, free (ADR-024; moved ahead of 9 and 10). Email later                      | 🟡 Ready |

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
  fuel, Tunisia's official pump prices per grade (exact, with their effective
  date), the last price per fuel type, stations logged within 300 m, recent
  stations and habitual whole amounts.
- 26 unit tests and a 30-test integration suite.

**Frontend**

- `/vehicles/:id/fuel`: economy panel (average, spend, price, cost per km, a
  per-tank trend line) and the fuel log with filters, edit, delete and receipts.
  A fuel card on the vehicle page.
- The form is built for a phone at the pump: type the amount paid, and the
  litres follow from the official price for the grade (preselected from what the
  car last took; diesel's three grades are chips). Today, the car's fuel and a
  full tank are preselected; the station comes from the phone's location —
  history first, then OpenStreetMap from the browser, rounded to ~11 m; usual
  amounts and recent stations are chips. Typing litres instead also works, and
  typing both lets the server derive the price. The mileage is shown as a hint,
  never guessed. 17 unit tests.

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

## Phase 6 — delivered

**Backend**

- `MaintenanceRecord` and `MaintenanceSchedule` as specified, with hand-written
  CHECKs: a schedule needs an interval, costs are non-negative, and a record has
  an expense exactly when it cost something.
- A service is logged like a fill-up: the record, its ledger expense and its
  `MAINTENANCE` odometer reading in one transaction, vehicle locked first.
  Tyres and inspections land under their own ledger categories; the rest under
  maintenance.
- **Free services** (ADR-019). A warranty service still resets its schedule,
  but the ledger refuses zero, so it has no expense — and gains one if a cost
  is added later, or loses it if edited to zero. That is refused with 409 while
  receipts hang off the expense, rather than deleting them silently.
- Parts, labour and total: any may be missing, a total can be added up from the
  split, and a split that disagrees with the total by a millime is refused with
  the sum named.
- **The due engine** (`maintenance/domain/due.ts`), pure and run on every read:
  every N km, every N months, or whichever comes first. `DUE_SOON` inside the
  notify window, `DUE` from the due point until one window past it, then
  `OVERDUE`; `UNKNOWN` with no service to count from, rather than counting from
  0 km. Calendar dates in the owner's time zone, months clamped at month end.
- The schedule's `lastService*` is a baseline that linked records supersede,
  never overwrite, so deleting a record restores the schedule. Schedules list
  most urgent first, paused last; deleting one keeps its records, unlinked.
- The fuel module's exact unit maths moved to `common/money/units.ts`.
- 33 unit tests (engine boundaries, month ends, leap years, the Tunis-vs-UTC
  day) and a 30-test integration suite. Both the lock-first rule and the
  record-to-schedule link were checked by breaking them: five simultaneous
  submits then returned four 500s, and a logged service restarted nothing.

**Frontend**

- `/vehicles/:id/maintenance`: "What's due" with a status, a progress bar and
  one line per schedule ("Due in 3,520 km or by 1 Mar 2027"), then the service
  log with filters, edit, delete and invoices. A maintenance card on the
  vehicle page with the three schedules closest to due.
- Schedules from one-tap presets (oil and filter, technical inspection, filters,
  pads, tyres, coolant, battery, timing belt) with typical intervals flagged as
  "check your handbook"; "when was it last done" is optional.
- A schedule's **Log it** opens the service form with the job and schedule
  chosen; otherwise the one active schedule matching the job is preselected.
  Total first, with a "Free · under warranty" chip and an optional parts/labour
  split that adds itself up; recent workshops as chips; mileage a hint, never
  prefilled. 11 unit tests.

**Verified in the running app** against the dev database: a schedule created
from a preset, a service logged through "Log it" with a split total, the
schedule restarting from it, and falling back to its baseline when the service
was deleted. The test rows were removed afterwards and the car's mileage checked
unchanged.

**Not built:** reminders and notifications when something falls due (Phase 7's
job), predicting a km-based due _date_ from the car's pace, and a schedule
satisfied by several job types at once (a full service covering oil, filters and
plugs is one record against one schedule).

## Phase 7 — delivered

**Backend**

- `Reminder`, `Notification` and `EmailToken`, with the partial indexes the
  sweep, the unread badge and the email outbox read. Reminders hold a calendar
  `date` and/or a mileage; repeating ones are succeeded on completion, counted
  from the due date.
- The due engine gained `dueAt` for fixed due points, so reminders and
  schedules are classified by one rule.
- **The worker role** (ADR-020). `APP_ROLE` picks the module graph before Nest
  starts; `worker` opens no port. An hourly BullMQ job sweeps every unarchived
  car, plus one at boot. `dedupeKey` (subject, status, due point) makes each
  step announced once per cycle, whatever the number of sweeps or workers.
- **Email** as one digest per person, held until 08:00 in their time zone,
  claimed with `FOR UPDATE SKIP LOCKED` and marked sent in the same transaction.
  The table is the outbox: every sweep re-asks for anyone still owed one.
- **Account emails** (ADR-021), deferred since Phase 2: confirm your address
  (nothing is emailed until then), forgot password (same answer whether or not
  the account exists; a reset signs out every session), and a signed
  one-click unsubscribe with RFC 8058 headers.
- SMTP through nodemailer, optional like storage; the transport is checked at
  start-up. Compose gains `worker` and `mailpit`. Going online: `docs/email.md`.
- 24 unit tests and three integration suites (39 tests): reminders, the sweep
  and digest, account emails.

**Frontend**

- A bell with an unread count (polled every minute), a `/notifications` inbox,
  and `/vehicles/:id/reminders` with one-tap presets (insurance, road tax, loan,
  warranty) that fill in how often it repeats and how early to warn — never the
  date itself. A reminders card on the vehicle page.
- A banner until the email is confirmed; `/verify-email`, `/forgot-password`,
  `/reset-password` and `/unsubscribe`; an email switch in settings.

**Fixed during verification.**

- **The idempotency test could not fail.** With `skipDuplicates` removed, the
  repeated sweep's unique violations were caught per car and counted as
  `failed`, so "nothing new" still held. It now asserts `failed: 0` too.
- **A concurrency test did not test the race**, again (see Phase 4): three
  simultaneous password resets passed with the single-use guard removed,
  because the requests arrived in sequence. The guard now has a direct test.
- A comment claimed `SKIP LOCKED` prevents double sends. It does not — the row
  lock does; Postgres re-checks the WHERE after waiting. Removing the lock
  entirely does send duplicates, and the test catches it.

**Not built:** web push, unusual-consumption alerts and the sweep for
unconfirmed uploads (declined for this phase), changing one's email address,
and deleting a notification.

## Phase 7b — easier mileage entry — delivered

Asked for by Skander: typing six digits on a phone was slow, and a wrong digit
slipped through. One `MileageInput` now serves the fuel, service and expense
forms and the odometer timeline (ADR-022).

- **Type only the end.** After 122,700 km, "980" means 122,980 and "050" means
  123,050. The full reading is always written out underneath.
- **Mistakes are named as you type.** "+412 km since 28 Sep"; lower than the
  last reading is refused with the reading named; over 1,500 km a day is
  flagged as a probable typo.
- **Trip counter** at a fill-up: the trip km plus the last fill-up's reading.
- **Suggestions you tap, never silent guesses:** "About 122,970 km?" from the
  car's usual pace, and −10/+10/+100.
- **Dashboard photo**, read on the phone by Tesseract.js; numbers that fit the
  car are offered as buttons.
- `GET /vehicles/:id/odometer/context`: the readings either side of a moment,
  the usual km/day over six months, the last fill-up.
- 3 unit and 4 integration tests on the backend, 13 on the frontend.

**Fixed during verification.** The first digit grouping formatted the text as a
number and turned "050" into "50", which would have broken typing past a
thousand. Tesseract's "sparse text" mode returned nothing at all on a clean
test image; checked against a drawn dashboard (clock, temperature, trip
counter and "122 980"), automatic layout reads the mileage and the filter
drops the rest.

**Verified in the running app** with a throwaway account: every route through
the box in the fuel form, a fill-up saved from the trip counter, the photo
button on a drawn dashboard, and the box on the other three forms. The account
and its car were deleted afterwards. **Not verified:** a real photo of a real
dashboard, and the layout on a phone screen (the browser pane was hidden).

## Phase 8 — car papers (cut down) — delivered

Planned as a documents section with its own expiry dates. Skander questioned
the need: reminders already carry dates. Cut to what reminders lacked (ADR-023).

- **Files on reminders.** The insurance certificate kept on "Insurance
  renewal". Done on a repeating reminder keeps the old file and offers "Add
  the new one" on the next.
- **Car papers.** Registration card, insurance or inspection certificate,
  purchase papers: files with no expense or reminder, listed on the car page
  and typed by a chip.
- `Document.reminderId` with a CHECK against having two owners; uploads lock
  their owner, so the limits (10 per expense or reminder, 50 papers per car)
  hold under concurrency; deleting a reminder purges its files after commit.
- 7 integration tests.

**Verified in the running app** with a throwaway account: a paper uploaded to
MinIO and listed as "Registration card"; a certificate kept on a reminder,
counted, and "Add the new one" opening next year's reminder. The car was
deleted through the API, purging its files, then the account.

**Not built:** expiry dates on documents and their alerts (dates stay on
reminders), and a separate documents page.

## Phase 12 — going online — ready to deploy

Moved ahead of Trips and Analytics at Skander's request. All free, for him and
a few friends (ADR-024). The steps he follows are in `docs/deploy.md`.

- `render.yaml`: the API and worker as one free Docker service in Frankfurt,
  migrations at start-up, and a free Key Value queue (`noeviction`).
- The website forwards `/api` and `/health` to it (`API_PROXY_TARGET`) and
  calls its own address (`NEXT_PUBLIC_API_URL=same-origin`).
- `TRUST_PROXY` is a hop count; online it is 2.
- A scheduled GitHub Action keeps the free server awake.
- `GET /api/v1/features` says whether email and file storage work; the app
  hides the confirmation banner and "forgot password" when email is off.

**Found while preparing.** Render's free plan blocks outgoing email ports
(25, 465, 587) since September 2025, so the Gmail plan from Phase 7 cannot run
there. Email is off online until a Gmail-API mailer or a paid plan.

**Verified locally** with a production build in the online shape (port 3002,
same-origin, rewrites to the API): the forwarded routes answered, a new
account signed up, and a full reload stayed signed in through the rewrite.
**Not verified:** the real Vercel, Render, Neon and B2 accounts — those are
created by Skander following the guide.

## Deferred by design

Not built, and why: reading receipts to pre-fill an expense (OCR — needs a vision service; 4b attaches files only), multi-currency conversion (needs historical rates and a
product decision), depreciation modelling, OBD-II, GPS tracking, push
notifications, vehicle sharing UI (the data model already supports it).
