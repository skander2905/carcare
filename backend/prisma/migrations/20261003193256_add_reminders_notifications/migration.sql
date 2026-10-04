-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('INSURANCE', 'ROAD_TAX', 'LOAN', 'WARRANTY', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MAINTENANCE_DUE', 'REMINDER_DUE');

-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "createdById" UUID,
    "type" "ReminderType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "dueDate" DATE,
    "dueOdometerKm" INTEGER,
    "notifyBeforeDays" SMALLINT NOT NULL DEFAULT 30,
    "notifyBeforeKm" INTEGER NOT NULL DEFAULT 1000,
    "repeatEveryMonths" SMALLINT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleId" UUID,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" VARCHAR(200) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'PENDING',
    "emailedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_vehicleId_dueDate_idx" ON "reminders"("vehicleId", "dueDate");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints or partial indexes, so these are
-- written by hand.

-- A reminder with neither a date nor a mileage can never fall due.
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_has_due_point"
  CHECK ("dueDate" IS NOT NULL OR "dueOdometerKm" IS NOT NULL);
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_due_odometer_non_negative"
  CHECK ("dueOdometerKm" IS NULL OR "dueOdometerKm" >= 0);
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_notify_non_negative"
  CHECK ("notifyBeforeKm" >= 0 AND "notifyBeforeDays" >= 0);
-- Repeating counts months from the due date, so it needs one.
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_repeat_needs_date"
  CHECK ("repeatEveryMonths" IS NULL OR ("repeatEveryMonths" > 0 AND "dueDate" IS NOT NULL));
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_completed_iff_dated"
  CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL));

-- The hourly sweep only ever reads pending reminders. A partial index keeps
-- that scan proportional to the work outstanding rather than to history.
CREATE INDEX "reminders_pending_due_idx" ON "reminders" ("dueDate") WHERE "status" = 'PENDING';

-- The unread badge counts these on every page load.
CREATE INDEX "notifications_unread_idx" ON "notifications" ("userId") WHERE "readAt" IS NULL;
-- The email digest's outbox: rows still owed an email.
CREATE INDEX "notifications_email_pending_idx" ON "notifications" ("userId") WHERE "emailStatus" = 'PENDING';
