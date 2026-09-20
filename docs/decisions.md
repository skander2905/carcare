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
