# CarCare — Architecture

> Status: living document. Updated at the end of every delivery phase.

## 1. What the system is

CarCare answers one question well: **"How much is my car actually costing me?"**

Everything else — fuel logs, maintenance records, reminders, documents — exists to feed that
answer with trustworthy data. The architecture is therefore optimised around two things:

1. **Correct, auditable cost data.** Money and odometer values are validated server-side,
   stored as exact decimals, and never recomputed from client input.
2. **Cheap aggregation.** Cost-of-ownership, cost/km and consumption must be answerable with
   indexed SQL aggregates, not by shipping the user's history to the browser.

## 2. High-level shape

```
                    ┌──────────────────────────────┐
   Browser ───────► │  Next.js 16 (App Router)     │
                    │  React 19 · Tailwind 4       │
                    │  TanStack Query · RHF + Zod  │
                    └──────────────┬───────────────┘
                                   │  REST/JSON over HTTPS
                                   │  Bearer access token (in memory)
                                   │  httpOnly refresh cookie
                    ┌──────────────▼───────────────┐
                    │  NestJS 12 API (stateless)   │
                    │  ┌────────────────────────┐  │
                    │  │ Controllers  (thin)    │  │
                    │  │ Services (domain rules)│  │
                    │  │ Repositories (Prisma)  │  │
                    │  └────────────────────────┘  │
                    └───┬──────────┬───────────┬───┘
                        │          │           │
              ┌─────────▼──┐  ┌────▼─────┐  ┌──▼─────────┐
              │ PostgreSQL │  │  Redis   │  │ S3 / MinIO │
              │  (source   │  │ (queues, │  │ (documents)│
              │  of truth) │  │  cache)  │  └────────────┘
              └────────────┘  └────┬─────┘
                                   │ BullMQ
                          ┌────────▼─────────┐
                          │  Worker process  │
                          │  (same codebase, │
                          │   different role)│
                          └──────────────────┘
```

The API and the worker are **the same image started with a different role**
(`APP_ROLE=api` / `APP_ROLE=worker`). One codebase, one dependency graph, one deploy
artifact — but the worker never binds an HTTP port and the API never runs a job processor.
This keeps long-running work off the request path while avoiding a second repo to maintain.

## 3. Layering rules (enforced, not aspirational)

| Layer                   | May depend on                                  | Must never                                            |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Controller              | Services, DTOs                                 | Touch Prisma, contain branching business rules        |
| Service                 | Repositories, other Services, domain functions | Know about HTTP (`Request`, `Response`, status codes) |
| Repository              | Prisma client                                  | Contain business rules                                |
| Domain (pure functions) | nothing                                        | Do I/O                                                |

**The domain layer is the important one.** Calculations that define the product —
fuel consumption, cost/km, "when is this service due", total cost of ownership — live in
pure, dependency-free functions under `src/<module>/domain/`. They take primitives and
return primitives. That makes them exhaustively unit-testable without a database, and it
means the rules can be reused by the API, the worker, and future clients unchanged.

Controllers translate HTTP → DTO → service call → DTO. Nothing else.

## 4. Module map

```
backend/src/
  common/            cross-cutting: filters, interceptors, decorators, pagination, pipes
  config/            typed, Zod-validated configuration
  prisma/            PrismaService, transaction helpers
  health/            liveness/readiness probes (DB + Redis)
  auth/              register, login, refresh rotation, guards, strategies
  users/             profile, preferences
  vehicles/          vehicle CRUD, membership + access control
  odometer/          odometer readings, the mileage timeline
  fuel/              fuel entries, consumption engine
  expenses/          the universal cost ledger
  maintenance/       records + schedules + due engine
  reminders/         generic reminder engine
  documents/         presigned upload/download, metadata
  trips/             trip log + estimated trip cost
  analytics/         SQL aggregate read models
  notifications/     in-app notifications, delivery adapters
  jobs/              BullMQ queues, processors, schedulers
  storage/           S3/MinIO adapter (interface + implementation)
```

Each feature module owns: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/`,
`domain/`, and its own tests. Modules talk to each other through **services**, never by
reaching into another module's repository.

## 5. Key architectural decisions (short form)

Full rationale and rejected alternatives live in [`decisions.md`](./decisions.md).

- **Expense is the universal cost ledger.** Fuel and maintenance records own a 1:1 `Expense`
  row. Total cost of ownership is then one indexed `GROUP BY` instead of a four-table UNION.
- **Odometer history is a first-class table.** Every record that carries a mileage value also
  writes an `OdometerReading` inside the same transaction. Mileage charts and
  "distance driven in period" become single indexed range scans.
- **Money is `numeric`, never float.** Exact decimal arithmetic end to end.
- **Access is resolved through `VehicleMember`,** not through `vehicle.ownerId`. V1 only ever
  creates `OWNER` rows, but vehicle sharing becomes an insert rather than a migration.
- **Refresh tokens are opaque, hashed at rest, rotated on use, and grouped into families**
  so that replaying a stolen token revokes the whole family.
- **Background work is queue-based.** HTTP handlers enqueue; workers execute. Notifications
  are idempotent via a unique `dedupeKey`.

## 6. Request lifecycle

```
HTTP request
  → Helmet / CORS
  → Pino request logger (assigns request id, redacts secrets)
  → RateLimitGuard (Redis sliding window; only routes carrying @RateLimit)
  → JwtAuthGuard (validates access token → req.user, unless @Public)
  → VehicleAccessGuard (resolves VehicleMember for :vehicleId → req.vehicleAccess)
  → ValidationPipe (DTO validation + transformation, whitelist + forbidNonWhitelisted)
  → Controller
  → Service (business rules, transactions)
  → Repository (Prisma)
  ← Serialization interceptor (strips sensitive fields)
  ← Global exception filter (uniform error envelope)
```

Authorization is enforced **at the guard and again in the service query**. Every repository
read is scoped by vehicle id that has already been authorised; no endpoint trusts an id from
the client without a membership check.

## 7. Background jobs

```
POST /vehicles/:id/reminders
        │
        ├─► write Reminder row            (transactional, fast)
        └─► enqueue "reminder.evaluate"   (Redis / BullMQ)

repeatable job "reminders.sweep" (cron, every hour)
        │
        ├─► find reminders crossing their threshold
        ├─► create Notification (idempotent via dedupeKey)
        └─► enqueue "notification.deliver" → email adapter
```

Queues used: `reminders`, `notifications`, `documents`, `maintenance`.
Every job is idempotent — a job that runs twice must not produce two notifications.

## 8. Scaling posture

The API is stateless: no session affinity, no in-process caches that matter, no local disk
writes. That means `N` API replicas behind a load balancer with zero coordination. State
lives in Postgres (durable), Redis (ephemeral + queues) and S3 (blobs).

The known scaling pressure points, in the order they would actually bite:

1. **Analytics aggregates** — mitigated first by covering indexes, then by materialised
   views refreshed by a worker, then by pre-computed monthly rollup tables.
2. **Reminder sweeps** — a full-table scan per tick does not survive growth. Mitigated by a
   partial index on due/pending reminders and by sharding the sweep by vehicle id range.
3. **Document uploads** — never proxied through the API. Clients PUT directly to S3 with a
   presigned URL, so upload bandwidth does not consume API capacity.

## 9. Environments

| Concern        | Local                | CI                           | Production                         |
| -------------- | -------------------- | ---------------------------- | ---------------------------------- |
| Postgres       | Docker Compose       | GH Actions service container | Managed instance                   |
| Redis          | Docker Compose       | GH Actions service container | Managed instance                   |
| Object storage | MinIO                | MinIO service container      | S3-compatible bucket               |
| Secrets        | `.env` (gitignored)  | GH Actions secrets           | Platform secret store              |
| Migrations     | `prisma migrate dev` | `prisma migrate deploy`      | `prisma migrate deploy` on release |
