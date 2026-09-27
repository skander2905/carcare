-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'MAINTENANCE', 'REPAIR', 'INSURANCE', 'TAX', 'PARKING', 'TOLL', 'CLEANING', 'ACCESSORIES', 'TIRES', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'FUEL', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "createdById" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "incurredAt" TIMESTAMPTZ(3) NOT NULL,
    "odometerKm" INTEGER,
    "description" VARCHAR(200),
    "vendor" VARCHAR(120),
    "notes" TEXT,
    "sourceType" "ExpenseSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "resourceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_vehicleId_incurredAt_idx" ON "expenses"("vehicleId", "incurredAt" DESC);

-- CreateIndex
CREATE INDEX "expenses_vehicleId_category_incurredAt_idx" ON "expenses"("vehicleId", "category", "incurredAt");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_userId_key_key" ON "idempotency_keys"("userId", "key");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A cost is positive. Prisma cannot express CHECK constraints, so this is
-- written by hand: the database refuses a zero or a negative amount even from a
-- writer that skipped validation, rather than letting it skew every total.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
