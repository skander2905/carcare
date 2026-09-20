-- CreateEnum
CREATE TYPE "VehicleRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC', 'CVT');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('MANUAL', 'FUEL', 'EXPENSE', 'MAINTENANCE', 'TRIP');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "make" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "year" SMALLINT NOT NULL,
    "licensePlate" VARCHAR(32) NOT NULL,
    "vin" VARCHAR(17),
    "fuelType" "FuelType" NOT NULL,
    "engineSize" DECIMAL(3,1),
    "transmission" "Transmission",
    "currentOdometerKm" INTEGER NOT NULL DEFAULT 0,
    "purchaseDate" TIMESTAMPTZ(3),
    "purchasePrice" DECIMAL(12,3),
    "color" VARCHAR(32),
    "notes" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_members" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "VehicleRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odometer_readings" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "source" "OdometerSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odometer_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_ownerId_idx" ON "vehicles"("ownerId");

-- CreateIndex
CREATE INDEX "vehicles_ownerId_archivedAt_idx" ON "vehicles"("ownerId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_ownerId_licensePlate_key" ON "vehicles"("ownerId", "licensePlate");

-- CreateIndex
CREATE INDEX "vehicle_members_userId_idx" ON "vehicle_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_members_vehicleId_userId_key" ON "vehicle_members"("vehicleId", "userId");

-- CreateIndex
CREATE INDEX "odometer_readings_vehicleId_recordedAt_idx" ON "odometer_readings"("vehicleId", "recordedAt");

-- CreateIndex
CREATE INDEX "odometer_readings_vehicleId_odometerKm_idx" ON "odometer_readings"("vehicleId", "odometerKm");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_members" ADD CONSTRAINT "vehicle_members_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_members" ADD CONSTRAINT "vehicle_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
