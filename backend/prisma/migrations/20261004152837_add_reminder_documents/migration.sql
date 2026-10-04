-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "reminderId" UUID;

-- CreateIndex
CREATE INDEX "documents_reminderId_idx" ON "documents"("reminderId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A document belongs to an expense, to a reminder, or to the car itself — one
-- at most. Both would mean deleting either one silently deletes a file the
-- other still shows.
ALTER TABLE "documents" ADD CONSTRAINT "documents_one_owner"
  CHECK ("expenseId" IS NULL OR "reminderId" IS NULL);
