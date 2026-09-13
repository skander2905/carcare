# CarCare — Data Model

> The schema is grown one migration per phase. This document describes the
> **target** model; each entity notes the phase that introduces it.

## 1. Conventions

| Concern      | Decision                                    | Why                                                                                                                                                                    |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys | UUID v7 (`@db.Uuid`)                        | Sortable by creation time (unlike v4), so index locality is good, while still being safe to expose in URLs and to generate client-side.                                |
| Money        | `numeric(12,3)` via Prisma `Decimal`        | Exact decimal arithmetic. TND is a **three**-decimal currency (1 dinar = 1000 millimes), so a two-decimal assumption would silently round every amount. Never `float`. |
| Volume       | `numeric(8,3)` litres                       | Pump receipts are three decimals.                                                                                                                                      |
| Distance     | `integer` kilometres                        | Odometers are whole numbers; integers keep comparisons and differences exact.                                                                                          |
| Timestamps   | `timestamptz(3)`                            | Always stored in UTC with an offset. A naive `timestamp` makes "spending this month" wrong for anyone who travels.                                                     |
| Table names  | `snake_case` plural via `@@map`             | Conventional SQL, while the Prisma API stays camelCase.                                                                                                                |
| Deletes      | `onDelete: Cascade` from vehicle-owned rows | A deleted vehicle must not leave orphaned cost records that would still be counted by aggregates.                                                                      |

## 2. Entity relationship overview

```
                       ┌──────────┐
                       │   User   │
                       └────┬─────┘
                            │ 1
             ┌──────────────┼───────────────┬──────────────────┐
             │ n            │ n             │ n                │ n
      ┌──────▼───────┐ ┌────▼─────────┐ ┌───▼──────────┐ ┌─────▼────────┐
      │ RefreshToken │ │ VehicleMember│ │ Notification │ │   Vehicle    │
      └──────────────┘ └────┬─────────┘ └──────────────┘ │  (ownerId)   │
                            │ n                          └─────┬────────┘
                            │ 1                                │ 1
                       ┌────▼─────────┐                        │
                       │   Vehicle    │◄───────────────────────┘
                       └────┬─────────┘
                            │ 1
   ┌────────────┬───────────┼────────────┬─────────────┬──────────────┐
   │ n          │ n         │ n          │ n           │ n            │ n
┌──▼───────┐ ┌──▼────────┐ ┌▼──────────┐ ┌▼──────────┐ ┌▼───────────┐ ┌▼─────────┐
│ Expense  │ │ FuelEntry │ │Maintenance│ │ Reminder  │ │  Document  │ │   Trip   │
│ (ledger) │ │           │ │  Record   │ │           │ │            │ │          │
└──▲───────┘ └──┬────────┘ └─┬───┬─────┘ └───────────┘ └────────────┘ └──────────┘
   │  1:1       │            │   │
   └────────────┘            │   │ n
   └─────────────────────────┘   │ 1
                          ┌──────▼──────────────┐
                          │ MaintenanceSchedule │
                          └─────────────────────┘

                       ┌──────────────────┐
      Vehicle 1 ──── n │ OdometerReading  │   (mileage timeline)
                       └──────────────────┘
```

## 3. Two decisions that shape everything

### 3.1 `Expense` is the universal cost ledger

Fuel purchases and maintenance jobs are _also_ expenses. Rather than summing
four tables to answer "what has this car cost me", every cost lands in
`expenses`, and `FuelEntry` / `MaintenanceRecord` own a **1:1** expense row
holding their domain-specific detail.

Total cost of ownership therefore becomes one indexed aggregate:

```sql
SELECT category, SUM(amount)
FROM expenses
WHERE vehicle_id = $1 AND incurred_at >= $2
GROUP BY category;
```

instead of a four-way `UNION ALL` that no index can serve well.

**Trade-off.** Creating a fuel entry now writes two rows, which must happen in
one transaction or the ledger drifts. The `Expense.sourceType` column records
where a row came from (`MANUAL`, `FUEL`, `MAINTENANCE`) so the UI can prevent a
fuel-derived amount from being edited independently and double-counted.

### 3.2 Odometer history is its own table

Mileage arrives from five places (manual readings, fuel stops, expenses,
maintenance, trips). `OdometerReading` is the timeline, written by a single
`OdometerService` inside the same transaction as the owning record.

This buys: one indexed range scan for the mileage chart, a cheap
"kilometres driven between two dates" for cost-per-km, and a single place to
enforce the rule that odometer values must not go backwards.

**Trade-off.** Write amplification and a consistency obligation. Both are
contained in one service, and a periodic reconciliation job (Phase 7) re-derives
the timeline to catch any drift.

## 4. Entities

### User — _Phase 1_

`id`, `email` (unique, lower-cased), `passwordHash`, `displayName`, `role`,
`currency`, `locale`, `timezone`, timestamps.

Email is normalised before insert so `Skander@x.com` and `skander@x.com` cannot
both register. `currency` is a per-user display default; per-record currency is
deliberately deferred (see [decisions.md](./decisions.md) ADR-008).

### RefreshToken — _Phase 1_

`id`, `userId`, `tokenHash` (unique, SHA-256), `familyId`, `expiresAt`,
`revokedAt`, `userAgent`, `ipAddress`, `createdAt`.

Indexes: `userId`, `familyId`, `expiresAt`.

Only the hash is stored, so a database leak alone yields nothing replayable.
`familyId` groups every token descended from one login, which is what makes
replay detection possible.

### Vehicle — _Phase 3_

`id`, `ownerId`, `make`, `model`, `year`, `licensePlate`, `vin?`, `fuelType`,
`engineSize?`, `transmission?`, `currentOdometerKm`, `purchaseDate?`,
`purchasePrice?`, `color?`, `notes?`, `archivedAt?`, timestamps.

Indexes: `ownerId`, `(ownerId, archivedAt)`. Unique: `(ownerId, licensePlate)`.

`currentOdometerKm` is denormalised from `OdometerReading` because the dashboard
reads it on every page load and a `MAX()` subquery per vehicle is wasteful.

### VehicleMember — _Phase 3_

`id`, `vehicleId`, `userId`, `role` (`OWNER` | `EDITOR` | `VIEWER`), `createdAt`.
Unique `(vehicleId, userId)`; index on `userId`.

V1 only ever creates `OWNER` rows. It exists now because **authorisation resolves
through this table**, so vehicle sharing later is an `INSERT` plus an invite
endpoint rather than a migration that rewrites every access check.

### OdometerReading — _Phase 3_

`id`, `vehicleId`, `recordedAt`, `odometerKm`, `source`, `sourceId?`, `notes?`.
Index: `(vehicleId, recordedAt)`, `(vehicleId, odometerKm)`.

### Expense — _Phase 4_

`id`, `vehicleId`, `createdById`, `category`, `amount`, `currency`,
`incurredAt`, `odometerKm?`, `description?`, `vendor?`, `notes?`, `sourceType`,
timestamps.

Indexes: `(vehicleId, incurredAt DESC)` for the paginated list,
`(vehicleId, category, incurredAt)` for the category breakdown.
Check constraint: `amount > 0`.

### FuelEntry — _Phase 5_

`id`, `vehicleId`, `createdById`, `expenseId` (unique), `filledAt`,
`odometerKm`, `volumeLiters`, `pricePerLiter`, `totalCost`, `fuelType`,
`isFullTank`, `isMissedFill`, `stationName?`, `notes?`, timestamps.

Indexes: `(vehicleId, odometerKm)`, `(vehicleId, filledAt DESC)`.
Checks: `volumeLiters > 0`, `odometerKm >= 0`.

`isFullTank` and `isMissedFill` are what make consumption correct rather than
merely plausible — see [architecture.md](./architecture.md) and the fuel domain
module.

### MaintenanceRecord — _Phase 6_

`id`, `vehicleId`, `createdById`, `expenseId` (unique), `scheduleId?`, `type`,
`performedAt`, `odometerKm`, `partsCost`, `laborCost`, `totalCost`,
`serviceProvider?`, `description?`, `notes?`, timestamps.
Index: `(vehicleId, performedAt DESC)`, `(vehicleId, type, performedAt DESC)`.

### MaintenanceSchedule — _Phase 6_

`id`, `vehicleId`, `type`, `name`, `intervalKm?`, `intervalMonths?`,
`lastServiceOdometerKm?`, `lastServiceAt?`, `notifyBeforeKm`, `notifyBeforeDays`,
`isActive`, timestamps.

Check constraint: `intervalKm IS NOT NULL OR intervalMonths IS NOT NULL` — a
schedule with neither interval can never become due, so the database rejects it
rather than letting it sit there silently doing nothing.

### Reminder — _Phase 7_

`id`, `vehicleId`, `userId`, `type`, `title`, `description?`, `dueDate?`,
`dueOdometerKm?`, `notifyBeforeDays?`, `notifyBeforeKm?`, `status`,
`completedAt?`, timestamps.

Index: `(vehicleId, dueDate)`, and a **partial** index on
`(dueDate) WHERE status = 'PENDING'` — the hourly sweep only ever looks at
pending reminders, and a partial index keeps that scan proportional to the work
outstanding rather than to history.

### Notification — _Phase 7_

`id`, `userId`, `vehicleId?`, `type`, `title`, `body`, `data` (jsonb),
`dedupeKey`, `readAt?`, `createdAt`.

Unique `(userId, dedupeKey)`; index `(userId, createdAt DESC)`,
partial index on unread.

`dedupeKey` is the idempotency mechanism: the reminder sweep runs hourly and
would otherwise create a duplicate "insurance expires soon" notification every
hour. The unique constraint makes a repeated insert a no-op, so job retries and
overlapping workers are safe by construction rather than by careful timing.

### Document — _Phase 8_

`id`, `vehicleId`, `uploadedById`, `type`, `title`, `fileName`, `mimeType`,
`sizeBytes`, `storageKey` (unique), `checksum?`, `status`, `issuedAt?`,
`expiresAt?`, `expenseId?`, `maintenanceRecordId?`, timestamps.

Index: `(vehicleId, type)`, `(vehicleId, expiresAt)`.

`status` (`PENDING_UPLOAD` → `READY` | `FAILED`) exists because uploads are
direct-to-S3 via a presigned URL: the metadata row is created before the bytes
exist, and the client confirms afterwards. Rows stuck in `PENDING_UPLOAD` are
swept by a background job.

### Trip — _Phase 10_

`id`, `vehicleId`, `createdById`, `startedAt`, `endedAt?`, `startLocation?`,
`endLocation?`, `odometerStartKm?`, `odometerEndKm?`, `distanceKm`, `purpose`,
`notes?`, timestamps. Index: `(vehicleId, startedAt DESC)`.

Estimated fuel cost is computed on read from recent consumption and recent fuel
price. Storing it would freeze a number that should move as better data arrives.

## 5. Enumerations

| Enum               | Values                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UserRole`         | `USER`, `ADMIN`                                                                                                                                                            |
| `VehicleRole`      | `OWNER`, `EDITOR`, `VIEWER`                                                                                                                                                |
| `FuelType`         | `PETROL`, `DIESEL`, `HYBRID`, `ELECTRIC`, `LPG`, `OTHER`                                                                                                                   |
| `ExpenseCategory`  | `FUEL`, `MAINTENANCE`, `REPAIR`, `INSURANCE`, `TAX`, `PARKING`, `TOLL`, `CLEANING`, `ACCESSORIES`, `TIRES`, `INSPECTION`, `OTHER`                                          |
| `ExpenseSource`    | `MANUAL`, `FUEL`, `MAINTENANCE`                                                                                                                                            |
| `MaintenanceType`  | `OIL_CHANGE`, `OIL_FILTER`, `AIR_FILTER`, `CABIN_FILTER`, `BRAKE_PADS`, `BRAKE_DISCS`, `TIRES`, `BATTERY`, `COOLANT`, `TRANSMISSION`, `TIMING_BELT`, `INSPECTION`, `OTHER` |
| `OdometerSource`   | `MANUAL`, `FUEL`, `EXPENSE`, `MAINTENANCE`, `TRIP`                                                                                                                         |
| `ReminderType`     | `MAINTENANCE`, `INSURANCE`, `REGISTRATION`, `INSPECTION`, `CUSTOM`                                                                                                         |
| `ReminderStatus`   | `PENDING`, `NOTIFIED`, `COMPLETED`, `DISMISSED`                                                                                                                            |
| `DocumentType`     | `INSURANCE`, `REGISTRATION`, `INSPECTION`, `INVOICE`, `RECEIPT`, `PURCHASE`, `OTHER`                                                                                       |
| `DocumentStatus`   | `PENDING_UPLOAD`, `READY`, `FAILED`                                                                                                                                        |
| `TripPurpose`      | `PERSONAL`, `WORK`, `VACATION`, `OTHER`                                                                                                                                    |
| `NotificationType` | `MAINTENANCE_DUE`, `DOCUMENT_EXPIRING`, `REMINDER_DUE`, `UNUSUAL_CONSUMPTION`, `COST_MILESTONE`                                                                            |

`MaintenanceStatus` (`UPCOMING`, `DUE_SOON`, `DUE`, `OVERDUE`) is deliberately
**not** stored. It is derived from current mileage and today's date, so a stored
copy would be stale the moment either changes.

## 6. Indexing rationale

Indexes are chosen from the queries the product actually runs, not added
speculatively — each one is write cost paid on every insert.

| Query                                              | Index                                                |
| -------------------------------------------------- | ---------------------------------------------------- |
| Expense list, newest first, paginated              | `(vehicle_id, incurred_at DESC)`                     |
| Spend by category for a period                     | `(vehicle_id, category, incurred_at)`                |
| Previous full-tank fill before an odometer reading | `(vehicle_id, odometer_km)`                          |
| Mileage timeline for a date range                  | `(vehicle_id, recorded_at)`                          |
| Hourly sweep for due reminders                     | partial index on `due_date WHERE status = 'PENDING'` |
| Unread notification badge                          | partial index on `(user_id) WHERE read_at IS NULL`   |
| Documents expiring soon                            | `(vehicle_id, expires_at)`                           |

## 7. Migration discipline

- One migration per phase, generated with `prisma migrate dev` and committed.
- CI applies them with `prisma migrate deploy` — the same command a release
  uses — so drift fails a pull request rather than a deployment.
- Migrations are written to be backwards-compatible with the running version
  (expand/contract), so a rollback never requires undoing a migration.
