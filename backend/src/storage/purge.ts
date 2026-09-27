import { type Logger } from '@nestjs/common';
import { type ObjectStorage } from './object-storage.js';

/**
 * Deletes stored files after the rows that described them are gone.
 *
 * Always *after* the database commit, never before: deleting first and then
 * failing to commit would leave rows pointing at files that no longer exist,
 * which is data loss. Deleting after, a failure leaves only unreferenced bytes
 * — wasted space, which the Phase 7 reconciliation job reclaims.
 *
 * So a storage failure here is logged, not thrown: the thing the caller asked
 * for — deleting the expense, the vehicle, the attachment — has happened.
 */
export async function purgeObjects(storage: ObjectStorage, keys: string[], logger: Logger): Promise<void> {
  if (keys.length === 0 || !storage.enabled) return;

  try {
    await storage.delete(keys);
  } catch (error) {
    logger.warn({ err: error, keys: keys.length }, 'Could not delete stored files; they are now orphaned');
  }
}
