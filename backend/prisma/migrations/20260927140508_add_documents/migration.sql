-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INSURANCE', 'REGISTRATION', 'INSPECTION', 'INVOICE', 'RECEIPT', 'PURCHASE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "uploadedById" UUID,
    "type" "DocumentType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "checksum" VARCHAR(128),
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "issuedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "expenseId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_vehicleId_type_idx" ON "documents"("vehicleId", "type");

-- CreateIndex
CREATE INDEX "documents_vehicleId_expiresAt_idx" ON "documents"("vehicleId", "expiresAt");

-- CreateIndex
CREATE INDEX "documents_expenseId_idx" ON "documents"("expenseId");

-- CreateIndex
CREATE INDEX "documents_status_createdAt_idx" ON "documents"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Written by hand; Prisma cannot express CHECK constraints. A document always
-- has bytes. The upper bound is policy and lives in the API, where it can
-- change without a migration.
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_positive" CHECK ("sizeBytes" > 0);
