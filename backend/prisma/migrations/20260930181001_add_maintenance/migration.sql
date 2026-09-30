-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('OIL_CHANGE', 'OIL_FILTER', 'AIR_FILTER', 'CABIN_FILTER', 'BRAKE_PADS', 'BRAKE_DISCS', 'TIRES', 'BATTERY', 'COOLANT', 'TRANSMISSION', 'TIMING_BELT', 'INSPECTION', 'OTHER');

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "createdById" UUID,
    "expenseId" UUID,
    "scheduleId" UUID,
    "type" "MaintenanceType" NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "partsCost" DECIMAL(12,3),
    "laborCost" DECIMAL(12,3),
    "totalCost" DECIMAL(12,3) NOT NULL,
    "serviceProvider" VARCHAR(120),
    "description" VARCHAR(200),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_schedules" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "intervalKm" INTEGER,
    "intervalMonths" SMALLINT,
    "lastServiceOdometerKm" INTEGER,
    "lastServiceAt" TIMESTAMPTZ(3),
    "notifyBeforeKm" INTEGER NOT NULL DEFAULT 1000,
    "notifyBeforeDays" SMALLINT NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_records_expenseId_key" ON "maintenance_records"("expenseId");

-- CreateIndex
CREATE INDEX "maintenance_records_vehicleId_performedAt_idx" ON "maintenance_records"("vehicleId", "performedAt" DESC);

-- CreateIndex
CREATE INDEX "maintenance_records_vehicleId_type_performedAt_idx" ON "maintenance_records"("vehicleId", "type", "performedAt" DESC);

-- CreateIndex
CREATE INDEX "maintenance_records_scheduleId_performedAt_idx" ON "maintenance_records"("scheduleId", "performedAt");

-- CreateIndex
CREATE INDEX "maintenance_schedules_vehicleId_isActive_idx" ON "maintenance_schedules"("vehicleId", "isActive");

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "maintenance_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints, so these are written by hand.
-- A schedule with neither interval can never become due; refuse it rather
-- than let it sit there silently doing nothing.
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_has_interval"
  CHECK ("intervalKm" IS NOT NULL OR "intervalMonths" IS NOT NULL);
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_interval_km_positive"
  CHECK ("intervalKm" IS NULL OR "intervalKm" > 0);
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_interval_months_positive"
  CHECK ("intervalMonths" IS NULL OR "intervalMonths" > 0);
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_notify_non_negative"
  CHECK ("notifyBeforeKm" >= 0 AND "notifyBeforeDays" >= 0);
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_baseline_non_negative"
  CHECK ("lastServiceOdometerKm" IS NULL OR "lastServiceOdometerKm" >= 0);

ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_odometer_non_negative"
  CHECK ("odometerKm" >= 0);
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_costs_non_negative"
  CHECK ("totalCost" >= 0 AND ("partsCost" IS NULL OR "partsCost" >= 0) AND ("laborCost" IS NULL OR "laborCost" >= 0));
-- A paid service has its ledger row and a free one has none: the ledger
-- refuses a zero amount, and a cost missing from it would under-report TCO.
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_expense_iff_paid"
  CHECK (("expenseId" IS NULL) = ("totalCost" = 0));
