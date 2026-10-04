# Architecture Decision Records

Each record states the problem, the decision, what it costs, and what was
rejected. Decisions that turned out badly get a follow-up record rather than a
quiet edit.

---

## ADR-001 — PostgreSQL as the system of record

**Context.** The product is fundamentally a financial ledger with time-series
reporting: sums by category over date ranges, running totals, "cost per
kilometre over the last six months". The data is highly relational (user →
vehicle → expense) and correctness of money matters more than write throughput.

**Decision.** PostgreSQL.

**Why, specifically:**

- `numeric` gives exact decimal arithmetic. Money in a float is a bug waiting to
  be reported by a user whose totals are off by a millime.
- Real transactions, so writing a fuel entry and its ledger expense either both
  land or neither does.
- Window functions and `date_trunc` mean monthly rollups and running totals are
  one query, not application-side aggregation.
- Partial and composite indexes match this workload exactly (see
  [database.md §6](./database.md)).
- `jsonb` provides an escape hatch for genuinely schemaless fields
  (notification payloads) without giving up schema elsewhere.

**Rejected.** MongoDB — the data is relational, and multi-document transactions
are a workaround rather than a foundation. SQLite — fine for a single user, but
it rules out the concurrent multi-replica deployment this project is meant to
demonstrate.

---

## ADR-002 — ESM + Vitest instead of CommonJS + Jest

**Context.** The brief specified Jest. NestJS 12 publishes **ESM only**: there is
no CommonJS build of `@nestjs/core` or `@nestjs/common`. TypeScript therefore
refuses to emit `require()` calls for them, so a CommonJS backend does not
compile at all.

**Decision.** The backend is a native ES module, and Vitest is the test runner.
Supertest is retained for HTTP-level integration tests exactly as specified.

**Consequences.**

- Relative imports carry explicit `.js` extensions — the `nodenext` convention,
  and what the official Nest generator emits.
- Vitest's API is Jest-compatible (`describe`/`it`/`expect`/`vi.mock`), so the
  tests read the same and the skill transfers.
- Vitest transforms TypeScript with esbuild, which does not implement
  `emitDecoratorMetadata`. Nest's constructor injection depends on that
  metadata, so `unplugin-swc` replaces esbuild for `.ts` files. A dependency-
  injection smoke test (`redis.health-indicator.spec.ts`) fails loudly if that
  ever regresses.

**Rejected.** Pinning NestJS 11 to keep Jest — choosing an older major to
accommodate a test runner is the wrong way round. Jest with
`--experimental-vm-modules` — works, but `jest.mock` becomes
`jest.unstable_mockModule` and the friction compounds across twelve phases.

---

## ADR-003 — pnpm workspaces

**Context.** Two deployables sharing conventions, tooling and types.

**Decision.** A pnpm workspace with `backend` and `frontend` packages.

**Consequences.** One lockfile and one CI install path. pnpm's content-addressed
store makes installs fast and its non-flat `node_modules` prevents accidental
reliance on undeclared transitive dependencies — a real class of "works locally,
breaks in Docker" bugs. The Dockerfiles must copy both the root and the package
`node_modules` for pnpm's symlinks to resolve, which is noted inline.

---

## ADR-004 — Expense as the universal cost ledger

**Context.** "What has this car cost me?" is the product's core question. Fuel,
maintenance and ad-hoc expenses all contribute.

**Decision.** Every cost is an `Expense` row. `FuelEntry` and
`MaintenanceRecord` own a 1:1 expense holding the domain detail.

**Consequences.** Total cost of ownership is a single indexed `GROUP BY` rather
than a four-table `UNION`. The cost is a second insert per fuel/maintenance
record, which must be transactional, and a double-counting risk if a user also
logs a manual "Fuel" expense — mitigated by `Expense.sourceType` and a UI that
does not allow editing a derived amount independently.

**Rejected.** Summing four tables at query time — the aggregation cost grows
with every new cost type, and no index serves it well.

---

## ADR-005 — Refresh token rotation with family-based replay detection

**Context.** Long-lived refresh tokens are the highest-value credential in the
system. A stolen one is indistinguishable from a legitimate one.

**Decision.**

- Access tokens are short-lived JWTs (15 minutes), held **in memory** in the
  browser — never in `localStorage`, where any XSS reads them.
- Refresh tokens are opaque random values in an `httpOnly`, `Secure`,
  `SameSite=Lax` cookie scoped to the auth path. JavaScript cannot read them.
- Only a SHA-256 hash is stored, so a database leak yields nothing replayable.
- Every refresh **rotates**: the presented token is revoked and a new one issued.
- Tokens descended from one login share a `familyId`. Presenting an
  already-rotated token means two parties hold the same token, so the **entire
  family is revoked** and both are forced to log in again.

**Consequences.** A stolen token is useful only until the victim's next refresh,
at which point the theft is detected and the session killed. The cost is a
database round trip per refresh (acceptable: once every 15 minutes per session)
and a login prompt if a client races two refreshes — handled client-side by
funnelling refreshes through a single in-flight promise.

**Rejected.** Long-lived JWTs with no server state — no way to revoke.
`localStorage` tokens — one XSS is a total compromise.

---

## ADR-006 — Authorisation resolves through `VehicleMember`, always server-side

**Context.** The hard requirement is that a user can never reach another user's
vehicle data. The brief also anticipates vehicle sharing later.

**Decision.** A `VehicleMember(vehicleId, userId, role)` table is the single
authority. A `VehicleAccessGuard` resolves the membership for `:vehicleId` on
every vehicle-scoped route and attaches the role to the request; repository
queries are then scoped by that already-authorised id.

No endpoint trusts an id from the client. `GET /vehicles/123` performs a
membership lookup before it performs a read.

**Consequences.** One extra indexed lookup per request, cacheable in Redis if it
ever matters. In V1 only `OWNER` rows are created, so the table looks redundant —
that is the point: sharing becomes an `INSERT` plus an invite endpoint rather
than a migration that rewrites every access check in the codebase.

**Rejected.** Checking `vehicle.ownerId === user.id` inline in each service —
it works until the day sharing ships, and then every call site is a place to
forget.

---

## ADR-007 — Redis for queues and distributed rate limiting

**Context.** Reminder sweeps, notification fan-out and document post-processing
must not run inside HTTP requests. Rate limiting must hold across API replicas.

**Decision.** Redis, with BullMQ for queues.

**Why BullMQ:** durable (jobs survive a restart), native support for delayed and
repeatable jobs — which is exactly what "check reminders hourly" and "notify 15
days before expiry" need — plus retries with backoff and a dead-letter path.

**Why not in-process `setInterval`:** with N replicas every tick runs N times,
and everything scheduled is lost on deploy.

**Why not a dedicated broker (RabbitMQ/SQS):** a second piece of infrastructure
for a workload Redis already handles, when Redis is needed anyway for rate
limiting and caching.

---

## ADR-008 — A hand-rolled Redis rate limiter instead of `@nestjs/throttler`

**Context.** `@nestjs/throttler` (6.5.0, current) declares peer support only up
to NestJS 11 and does not install against NestJS 12. Separately, its default
storage is **in-process** — with three API replicas a "5 requests per minute"
login limit is really 15.

**Decision.** A small Redis-backed sliding-window guard, applied to
authentication endpoints. The counter is incremented and expired atomically in a
Lua script so concurrent requests cannot race past the limit.

**Consequences.** Roughly a hundred lines to own and test, but the limit is
correct across replicas — which was the actual requirement — and there is no
dependency conflict. If Redis is unavailable the limiter fails **open** and logs:
losing rate limiting is bad, refusing all logins is worse.

---

## ADR-009 — Documents go straight to S3, never through the API

**Context.** Users upload insurance PDFs and service invoices.

**Decision.** Object storage (MinIO locally, any S3-compatible bucket in
production). PostgreSQL stores only metadata. Uploads and downloads use
**presigned URLs**, so bytes never transit the API.

**Flow.** Client requests an upload URL → API validates ownership, declared MIME
type and size, creates a `Document` row as `PENDING_UPLOAD` and returns a
short-lived presigned `PUT` → client uploads directly to S3 → client confirms →
row becomes `READY`. Rows left pending are swept by a background job.

**Consequences.** Upload bandwidth never consumes API capacity, and the API
stays stateless with no local disk. Access control needs care: presigned URLs
are unguessable but bearer-like, so they are issued only after an ownership
check and expire in minutes. Storage keys are random, never user-supplied
filenames — otherwise a crafted name is a path-traversal attempt.

**Bucket CORS.** Because the browser talks to the store directly, the bucket
must allow the web app's origin; the API's CORS settings never reach it.
Compose pins MinIO's `MINIO_API_CORS_ALLOW_ORIGIN` to `WEB_APP_URL`. An
externally managed bucket needs the equivalent rule, for example on S3:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Without it, uploads fail in the browser while every server-side test passes.

**Rejected.** `bytea` columns — bloats the database, destroys backup times, and
streams large blobs through the query path. Proxying downloads through the
API — burns a request worker for the duration of every download.

---

## ADR-010 — Preventing race conditions

Three distinct races exist, with three different mechanisms.

**1. Concurrent odometer writes.** Two fuel entries submitted at once could both
validate against the same "previous reading" and produce an inconsistent
timeline. Writes that depend on the current odometer take a
`SELECT ... FOR UPDATE` on the vehicle row inside the transaction, serialising
them per vehicle. Contention is per-vehicle, which for this product is
effectively zero.

**2. Duplicate notifications.** The reminder sweep runs hourly and would create
"insurance expires soon" every hour. `Notification` has a unique
`(userId, dedupeKey)`; the insert is an upsert, so a repeated job is a no-op.
Idempotency is enforced by the database, not by hoping jobs do not overlap.

**3. Concurrent token refresh.** Two tabs refreshing simultaneously would each
rotate the token and the loser would look like a replay. The client funnels all
refreshes through a single in-flight promise; the server treats a token reused
within a short grace window as the same logical refresh rather than an attack.

---

## ADR-011 — Analytics computed in SQL, not in the browser

**Context.** The dashboard needs monthly spend, category breakdowns,
consumption trends and cost per kilometre.

**Decision.** Aggregation happens in PostgreSQL. Endpoints return the handful of
rows a chart actually plots, never the underlying records.

```sql
SELECT date_trunc('month', incurred_at) AS month,
       category,
       SUM(amount) AS total
FROM expenses
WHERE vehicle_id = $1 AND incurred_at >= $2
GROUP BY 1, 2
ORDER BY 1;
```

**Consequences.** A vehicle with five years of history returns ~60 rows instead
of thousands of records, so payload and client CPU stay flat as data grows. The
escalation path, in order: covering indexes → materialised views refreshed by a
worker → pre-computed monthly rollup tables. None of that is built yet, and
building it before the indexes are proven insufficient would be speculation.

---

## ADR-012 — Cost per kilometre, defined precisely

Cost per kilometre is the headline number, so its definition is a product
decision as much as a technical one.

```
distance  = max(odometer in period) - min(odometer in period)
total cost = SUM(expenses.amount) over the same period
cost/km    = total cost / distance          -- undefined when distance = 0
```

Deliberate choices:

- **Distance comes from odometer readings, not from the sum of trips.** Trips
  are optional; the odometer is the ground truth.
- **When distance is zero, the answer is "not enough data"**, not zero and not
  infinity. A number that is confidently wrong is worse than an honest blank.
- **Purchase price is excluded from cost/km by default** and reported separately.
  Including a 40,000 TND purchase makes the first month's cost/km meaningless.
  Depreciation is a future feature with its own model.

Fuel consumption uses the **full-to-full** method rather than a naive
"litres ÷ distance since last fill":

```
Only two full-tank fills with no missed fill between them bound a valid window.
litres   = sum of every fill after the previous full tank, up to and including this one
distance = odometer(this full) - odometer(previous full)
L/100km  = litres / distance * 100
```

This is what makes partial fills correct. A naive calculation divides one
partial fill by the whole distance and reports a consumption figure that is
simply false — which is precisely the kind of quietly-wrong number this product
exists to avoid.

---

## ADR-013 — One image, two roles

**Context.** The API and the queue worker share domain logic. Two repositories,
or two images, means two dependency graphs to keep in step.

**Decision.** One image. `APP_ROLE=api` binds HTTP; `APP_ROLE=worker` registers
queue processors and binds nothing. Scale them independently.

**Consequences.** A worker image carries HTTP dependencies it does not use —
a few megabytes, in exchange for one build, one test suite and no possibility of
the two drifting apart.

---

## ADR-014 — Scaling posture

The API holds no state: no sessions, no local disk, no in-process caches that
matter. `N` replicas behind a load balancer need no coordination.

Where it would break first, and the answer:

| Pressure              | First symptom                             | Response                                                                     |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Analytics aggregates  | Dashboard latency grows with history      | Covering indexes → materialised views → monthly rollup tables                |
| Reminder sweep        | Sweep duration grows with total reminders | Partial index on pending reminders; then shard the sweep by vehicle id range |
| Notification fan-out  | Queue backlog                             | More worker replicas; BullMQ distributes by design                           |
| Read load             | Database CPU                              | Read replicas for analytics; writes stay on the primary                      |
| Connection exhaustion | `too many connections`                    | PgBouncer in transaction mode; Prisma pool sized per replica                 |

Deployment is rolling, with migrations applied as a separate step before the new
version serves traffic, and written to be backwards-compatible with the running
version (expand/contract) so a rollback never has to undo a migration.

---

## ADR-015 — REST over GraphQL or tRPC

**Context.** One first-party web client today, possibly a mobile client later.

**Decision.** REST with OpenAPI.

**Why.** The resource model maps cleanly onto URLs. HTTP caching, status codes
and idempotency semantics work without reinvention. OpenAPI generates browsable
documentation and typed clients for free. GraphQL solves over-fetching across
many heterogeneous clients — a problem this project does not have — and brings
query-cost analysis and N+1 protection as new obligations. tRPC is excellent but
couples the client to the server's TypeScript, which a future mobile app would
not share.

---

## ADR-016 — Single-currency V1, structured for more

`User.currency` is a display default and every amount is stored as exact
`numeric`. Per-record currency and conversion are deliberately **not** built:
doing it properly needs historical exchange rates and a decision about whether a
report values a purchase at the rate on the day or today's rate. That is a real
product question, not a schema detail. Adding `currency` to `Expense` later is
an additive migration with a backfill from `User.currency`.

---

## ADR-017 — Federated sign-in, and why a matching email is not proof of identity

**Context.** Users expect "Continue with Google". The API already has a session
model — short access JWTs plus rotating opaque refresh tokens — and a second
parallel notion of a session would be a second thing to get wrong.

**Decision.** The authorization-code flow with PKCE, run **server-side**.

- `GET /auth/oauth/:provider` issues `state` + a PKCE verifier, stores both in
  Redis for ten minutes, and redirects to the provider.
- The callback verifies `state` (deleting it in the same round trip, so it is
  single-use), exchanges the code, and validates the ID token's signature,
  issuer, audience and expiry against the provider's JWKS.
- It then issues **exactly the session a password login issues** and redirects
  into the web app. No token appears in the URL: the refresh cookie is set, and
  the web app's existing cold-load `/auth/refresh` turns it into an access
  token.

**A matching email address does not link accounts.** If a provider identity is
new and its address already belongs to a local account, the request is refused
with `oauth_email_taken`. Linking happens only from a session that has already
authenticated.

**Why, specifically.** This API does not verify email addresses at registration
— that needs a mail provider, which arrives in Phase 7. So a local account's
address is _unproven_: anyone can register as `victim@gmail.com`. Auto-linking
on a match would hand that squatter a shared account with the real owner the
moment the owner signed in with Google, and the squatter's password would still
work. The common "link when the provider says the email is verified" rule
verifies the wrong side: it establishes that Google trusts the address, not that
our existing local account does.

**Consequences.** One extra step for a genuine user who signed up with a
password and later wants Google. `/settings` exists to make that step
available, and the refusal message names it. Once email verification ships, this
decision is worth revisiting with a follow-up record rather than a quiet edit.

**Also decided.**

- Identity is the provider's `sub`, never the email. People change their address
  at the provider, and a recycled address must not resolve to someone else.
- Removing the last credential is refused. An account created through Google
  with no password has exactly one way in, and password reset does not exist yet.
- Providers are optional configuration. With no credentials the provider is not
  registered, `/auth/providers` returns `[]`, and no button renders — a fresh
  clone and CI must boot without secrets.

**Rejected.** The Google Identity Services button returning an ID token to the
browser — it works, but it is a second sign-in path with its own failure modes,
and it does not generalise to Apple, whose flow is a form POST. Auto-linking on
a verified provider email — unsafe here for the reason above. Storing `state` in
a signed cookie instead of Redis — self-contained means replayable, and the
callback URL would work twice.

---

## ADR-018 — Fuel: consumption on read, and where the station comes from

**Context.** Phase 5 adds fuel entries and the full-to-full consumption rule of
ADR-012. Two things needed deciding that the spec left open: where consumption
is computed, and how the fill-up form fills itself in — Skander asked for a form
that is mostly defaults and one-tap choices, with the station taken from where
the phone is.

**Decision — consumption.** A pure function (`fuel/domain/consumption.ts`) over
the vehicle's whole fill history, in integer centilitres and millimes, run on
every read. Nothing is stored: a corrected or deleted fill changes every window
after it, and a stored figure would need re-deriving on every write. A period's
average is Σ litres ÷ Σ distance over its windows, never the mean of their
figures, so a 60 km top-up window does not outvote a 900 km run.

**Decision — the station.** In order: stations this vehicle has logged within
300 m (matched by the API, so nothing leaves CarCare), then OpenStreetMap's
Overpass API, called **from the browser**, with coordinates rounded to four
places (about 11 m). The API never receives a location it is not asked to
store, and it stores one only on an entry dated today — a fill logged a day
later did not happen where the phone is now. Chosen over Google Places, which
needs a billed key and sends coordinates to Google, and over history alone,
which makes every new station a typing exercise.

**Decision — the price.** Someone at the pump types what they paid; the litres
follow from the price per litre, which the form already knows. For a vehicle in
dinars that is the state's price: Tunisia sets pump prices nationally, and
`fuel/domain/official-prices.ts` holds them exactly, per grade (sans plomb 2.525,
gasoil sans soufre 2.205, gasoil ordinaire 1.985 …), with the day they took
effect and the day someone last confirmed them. Elsewhere, or for LPG, whose
exact price neither source states, the last price paid stands in.

A live feed was rejected: GlobalPetrolPrices has an API, but it is paid and
rounds to two places (2.53 for 2.525), which puts every litres figure worked out
from an amount 0.2% off; the free sources are scraped pages with the same
rounding. A price the state fixes to the millime is better copied exactly than
fetched approximately. When prices change, a new list is appended — old lists
stay, for backdated entries — and the form nudges "glance at the pump" once the
table has gone six months unconfirmed.

The server still refuses a stated price more than 2% off total ÷ volume, with
the figure it should be: pump rounding is far below 2%, and the common typos (a
slipped decimal, the diesel price on a petrol fill) are far above it.

**Consequences.** Every list and consumption read loads the vehicle's full fill
history — about fifty narrow rows a year, served by `(vehicleId, odometerKm)`.
If a vehicle ever holds tens of thousands, the window grouping moves into SQL
(a running count of full tanks as the group key) behind the same function
signature. OSM coverage of station names varies; the chips and the text field
cover the gaps, and every saved entry teaches the history match.

**Also found.** Inserting a record before `OdometerService.recordIn` locked the
vehicle let two concurrent writes deadlock: each insert takes `FOR KEY SHARE`
on the vehicle for its foreign key, then both wait for `FOR UPDATE`. Callers now
take the lock first (`lockVehicleFor`). Phase 4's expense create had the same
latent bug for expenses carrying a mileage.

## ADR-019 — Maintenance: derived status, baselines, and free services

**Context.** Phase 6 adds service records and recurring schedules. The spec
fixed the tables and said status is derived, not stored; it left open what
"last serviced" means, what a schedule with no history reports, and how a
service that cost nothing fits a ledger that refuses zero.

**Decision — status.** A pure engine over the schedule's terms, its service
history, the car's current mileage and the owner's today. Each tracked
dimension is classified on its own and the more urgent wins: `UPCOMING`, then
`DUE_SOON` within the notify window, `DUE` from the due point until one window
past it, `OVERDUE` after. Dates are calendar dates in the owner's time zone
(amounts are in the owner's currency, ADR-016); "12 months after 31 January" is
the end of February. A schedule with no service to count from is `UNKNOWN`:
counting from 0 km would show an oil change on a 120,000 km car as eleven
intervals overdue.

**Decision — baselines.** `lastServiceOdometerKm` / `lastServiceAt` hold what
the owner remembered when setting the schedule up. Linked records are laid over
the baseline — the latest mileage and the latest date among them all, taken per
dimension — and never copied into it. Rejected: updating the columns when a
record is logged, which is one query cheaper per read but leaves the schedule
pointing at a service that no longer exists once that record is deleted or
corrected, with nothing left to restore it from.

**Decision — free services.** A warranty service or a dealer's free first
inspection resets its schedule, so it must be loggable. The ledger's
`amount > 0` rule stays — a zero row is noise in every cost report — and a free
record has no expense instead: `expenseId` is nullable, and a CHECK ties it to
`totalCost = 0` both ways. Editing a record across zero creates or deletes its
expense in the same transaction; deleting one that holds receipts is refused
with 409, since the receipts would go with it. Receipts attach to the expense,
as for fuel, so `Document.maintenanceRecordId` was dropped from the plan.

**Consequences.** Every schedule read costs one indexed query for its records;
a schedule is serviced once or twice a year, so this is a handful of rows.
Reminders (Phase 7) will call the same engine rather than duplicate it.

## ADR-020 — Reminders: a sweep that reads, a table that is the outbox

**Context.** Phase 7 turns due states into messages: an in-app inbox and email.
Two sources fall due — maintenance schedules (Phase 6) and one-off reminders
with a fixed date or mileage. Status is derived, never stored (ADR-019), so
nothing in the database flips when something becomes due; something has to
look.

**Decision — one sweep, hourly, in the worker.** A repeatable BullMQ job runs
the due engine over every active schedule and pending reminder of every
unarchived car, and inserts a notification for whatever is `DUE_SOON`, `DUE`
or `OVERDUE`. Reminders reuse the engine through `dueAt`, a fixed due point
classified by the same windows. Rejected: evaluating on every write (a fuel
fill, an odometer reading, a schedule edit), which would put notification logic
in five services and still miss the one change no write causes — the calendar
moving on.

**Decision — idempotency by key.** `dedupeKey` is the subject, the status and
the due point (`maintenance:<id>:DUE_SOON:130100km/-`), unique per user. Each
step is announced once per cycle; escalating announces again; logging the
service moves the due point and opens the next cycle. Repeated sweeps and
overlapping workers insert nothing, by constraint rather than by timing.

**Decision — email is a digest, sent in daylight, from an outbox.** Whether a
notification is owed an email is settled at insert (`PENDING` or `SKIPPED`:
email off, address unconfirmed, no transport). After each sweep, everyone with
`PENDING` rows gets one digest job, delayed to 08:00 in their own time zone if
it is night. The job claims rows with `FOR UPDATE SKIP LOCKED`, sends, and marks
them sent in one transaction: a failed send rolls back and retries; overlapping
jobs cannot send the same row twice. Rows read in the app before the morning
are skipped. Delivery is at-least-once — a crash between the server accepting
the email and the commit sends it twice, the right way round for a reminder.

**Decision — roles.** `APP_ROLE` picks the module graph before Nest starts:
`api` never loads BullMQ, `worker` opens no port, `all` is for local
development. Integration suites boot `AppModule`, so no schedule ever runs
behind a test.

**Consequences.** A notification can lag the moment it became true by up to an
hour, plus the night. The sweep is N small queries per car; architecture.md §8
already names it as a pressure point, and the keyset paging is where sharding
would go. Not built: per-write evaluation, web push, unusual-consumption alerts,
the sweep for unconfirmed uploads.

## ADR-021 — Account emails: confirming an address, resetting a password, stopping email

**Context.** Phase 2 deferred both for want of an email provider. Phase 7
brings one, and with it a new risk: anyone can register with someone else's
address, and reminders would then be mailed to a stranger.

**Decision — nothing is emailed to an unconfirmed address.** Sign-up sends a
confirmation link; reminders reach the in-app inbox regardless, but are only
emailed once `emailVerifiedAt` is set. A Google sign-up counts as confirmed
(the provider only returns verified addresses, ADR-017), and so does signing in
with or connecting Google whose address matches the account's. Existing
accounts in either situation were back-filled; other password accounts must
click the link.

**Decision — links are single-use random tokens.** 256 bits, stored as SHA-256
like refresh tokens, spent with a conditional update so two clicks cannot both
succeed. Confirm lasts 48 h, reset 1 h. A link names the address it was sent
to and is refused if the account's address has changed since. A reset sets
the password, revokes every refresh token, and confirms the address.

**Decision — "forgot password" never says whether an account exists.** Always
202; the email is sent without awaiting it, so the response time does not
differ either. Rate limited per IP and per address.

**Decision — unsubscribe without signing in.** Digests carry an HMAC-signed,
non-expiring link (derived from the access-token key) and RFC 8058
`List-Unsubscribe` headers, so Gmail shows its own button. The endpoint is POST
only; the link in the body opens a page with a button, because mail scanners
open links.

Asking for the link again when the server has no email set up answers 503
with a plain message, rather than "sent" with nothing sent.

**Decision — SMTP, chosen by configuration.** One transport speaks to Mailpit
locally, Gmail with an app password while the app has no domain of its own,
and Brevo once it does (`docs/email.md`). The worker and API check the server
at start-up and log a clear error if it refuses.

**Consequences.** A free `*.vercel.app` domain cannot carry SPF/DKIM records,
so authenticated sending from a provider needs a domain the project owns.
Changing one's email address still has no flow; when it gets one, it must clear
`emailVerifiedAt` and send a new link.

## ADR-022 — Mileage entry: complete, check, suggest — never guess silently

**Context.** Every record that carries a mileage asked for the whole reading,
six digits typed on a phone. One wrong digit passes validation when it still
fits the timeline, and corrupts consumption and every km-based due date.

**Decision — type the end, see the whole.** Fewer digits than the previous
reading are its end: the reading is the first number at or above the previous
one ending that way, as an odometer's wheels roll (after 122,700, "050" is
123,050). As many digits or more are a full number. Digit grouping works on the
text, so a leading zero survives. The full reading is always written out under
the box, with the distance since the previous reading.

**Decision — say what looks wrong before the server does.** Below the previous
reading or above the next is shown as the error the server would return; more
than 1,500 km a day since the previous reading passes but is flagged as a
probable typo.

**Decision — offer, never fill.** A suggestion from the car's usual pace
(six months of readings, at least 14 days apart, else nothing), the trip
counter added to the last fill-up's reading (fuel only), +/- buttons, and
numbers read from a dashboard photo. Each needs a tap — the rule from Phase 5
that a wrong guess must not pass silently still holds.

**Decision — the photo is read on the phone.** Tesseract.js in a Web Worker;
the photo never leaves the device. Its engine and English data come from the
jsDelivr CDN on first use. It misreads segment displays, so its output is
reduced to numbers that fit between the neighbouring readings and offered as
buttons. "Sparse text" layout returned nothing at all on a clean test image;
automatic layout is used. Rejected: a vision API (cost, a key, and the photo
leaving the device — Skander's choice).

**Consequences.** One small endpoint, `GET /vehicles/:id/odometer/context`,
which leaves out the record being edited so it is not compared with itself.
Self-hosting the OCR files is a Phase 12 item if the CDN dependency matters.

## ADR-023 — Documents: one place for dates, files where they belong

**Context.** Phase 8 was planned before reminders existed: vehicle documents
with their own expiry dates and an `DOCUMENT_EXPIRING` alert. Once Phase 7 had
reminders with a date, a warning window and repetition, that would have been a
second expiry system — the insurance renewal entered twice, once as a reminder
and once as a document, and the two free to disagree. Skander did not see the
need for it.

**Decision.** Dates live on reminders only. A document gains `reminderId`, so a
reminder can hold its papers (the certificate on "Insurance renewal"); a
completed repeating reminder keeps its files and its successor starts empty,
with an offer to add the new one. A document with no expense and no reminder
is one of the car's papers (registration card, purchase papers), listed on the
car page. Uploads lock their owner — expense, reminder, or the vehicle for a
paper — so the per-owner limit holds under concurrent uploads, and deleting a
reminder purges its stored files after commit, as an expense does.

**Rejected.** A document expiry date that creates a reminder (two sources of
one date); a separate "Documents" page (the papers belong with the car or the
reminder they explain).

**Consequences.** `issuedAt` and `expiresAt` stay in the table, unused, rather
than a migration to drop them for nothing. No new notification type.

## ADR-024 — Online for free: one address, one process, no email yet

**Context.** Skander wants CarCare online before Trips and Analytics, at no
cost, for himself and a few friends. The website and the API are separate
deployables; free hosting splits them across providers.

**Decision — one address.** Vercel serves the website and forwards `/api/*`
and `/health*` to the API on Render (Next.js rewrites, `API_PROXY_TARGET`). The
browser sees a single origin (`NEXT_PUBLIC_API_URL=same-origin`), so the
refresh cookie is first-party — Safari drops third-party cookies, and
`*.vercel.app` is a public suffix, so a second subdomain would be a second
site — and no CORS is needed. The proxy chain is two hops, so `TRUST_PROXY`
became a hop count (`2`) rather than a boolean; trusting every hop would let a
caller pick their own IP for rate limiting.

**Decision — one process.** Render's free web service runs `APP_ROLE=all`;
a free background worker does not exist. It sleeps after 15 idle minutes, so a
scheduled GitHub Action (free on a public repository) pings `/health/live`
every 10 minutes and the hourly sweep keeps running. Migrations run at
start-up because free services have no pre-deploy step. Redis is Render's free
Key Value (`noeviction`, as BullMQ requires; not persisted, which the outbox
design tolerates). Postgres is Neon, files Backblaze B2 (Cloudflare R2 needs a card, which Skander does not have; B2's CORS for uploads is set by `infrastructure/b2-allow-uploads.mjs`, since its web UI only allows downloads).

**Decision — no email yet.** Render's free plan blocks SMTP ports since
September 2025. Rather than a mail path that fails silently, the server
reports `GET /api/v1/features` and the web app hides what would need email —
the confirmation banner, "forgot password" — and says reminders arrive in the
app only. Turning email on later is a Gmail-API mailer or Render's paid plan
(docs/deploy.md).

**Consequences.** Four free accounts to look after. Cold starts if the
keep-awake job stops. Verified locally with a production build at the same
shape: sign-up and a full reload stayed signed in through the rewrite.
