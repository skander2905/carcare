-- CreateTable
CREATE TABLE "fuel_entries" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "createdById" UUID,
    "expenseId" UUID NOT NULL,
    "filledAt" TIMESTAMPTZ(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "volumeLiters" DECIMAL(7,2) NOT NULL,
    "pricePerLiter" DECIMAL(8,3) NOT NULL,
    "totalCost" DECIMAL(12,3) NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "isFullTank" BOOLEAN NOT NULL DEFAULT true,
    "isMissedFill" BOOLEAN NOT NULL DEFAULT false,
    "stationName" VARCHAR(120),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fuel_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fuel_entries_expenseId_key" ON "fuel_entries"("expenseId");

-- CreateIndex
CREATE INDEX "fuel_entries_vehicleId_odometerKm_idx" ON "fuel_entries"("vehicleId", "odometerKm");

-- CreateIndex
CREATE INDEX "fuel_entries_vehicleId_filledAt_idx" ON "fuel_entries"("vehicleId", "filledAt" DESC);

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints, so these are written by hand. The
-- database refuses an impossible fill even from a writer that skipped
-- validation, rather than letting it skew every consumption figure.
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_volume_positive" CHECK ("volumeLiters" > 0);
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_price_positive" CHECK ("pricePerLiter" > 0);
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_total_positive" CHECK ("totalCost" > 0);
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_odometer_non_negative" CHECK ("odometerKm" >= 0);
-- Half a coordinate is not a place.
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_coordinates_paired"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
