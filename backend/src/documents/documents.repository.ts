import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { DocumentStatus, type DocumentType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Document } from '../prisma/model.types.js';

export type NewDocument = Omit<
  Prisma.DocumentUncheckedCreateInput,
  'id' | 'status' | 'createdAt' | 'updatedAt'
>;

export type CreateOutcome =
  | { kind: 'created'; document: Document }
  | { kind: 'expense-missing' }
  | { kind: 'reminder-missing' }
  | { kind: 'vehicle-missing' }
  | { kind: 'limit-reached' };

const FOREIGN_KEY_VIOLATION = 'P2003';

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** For `DocumentAccessGuard`, before membership is known — reads nothing else. */
  async vehicleIdOf(id: string): Promise<string | null> {
    const row = await this.prisma.document.findUnique({ where: { id }, select: { vehicleId: true } });
    return row?.vehicleId ?? null;
  }

  /** Scoped by vehicle as well as id, for the same reason as ExpensesRepository. */
  findInVehicle(id: string, vehicleId: string): Promise<Document | null> {
    return this.prisma.document.findFirst({ where: { id, vehicleId } });
  }

  /**
   * Creates a document, enforcing its owner's limit atomically.
   *
   * Count-then-insert without a lock lets two simultaneous requests both see
   * nine and both insert. Locking the owner row — the expense, the reminder,
   * or for a car paper the vehicle — makes them take turns, and serialises the
   * upload with that owner being deleted, which holds the same lock while it
   * collects the files to purge, so a document cannot appear after that list
   * was taken.
   *
   * A vehicle deleted mid-request surfaces as a foreign-key violation: the
   * insert waits on the deletion's row lock, then finds nothing to point at.
   */
  async createWithinLimit(data: NewDocument, limit: number): Promise<CreateOutcome> {
    const live = { in: [DocumentStatus.PENDING_UPLOAD, DocumentStatus.READY] };
    try {
      return await this.prisma.$transaction(async (tx): Promise<CreateOutcome> => {
        let count: number;
        if (data.expenseId) {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM expenses
            WHERE id = ${data.expenseId}::uuid AND "vehicleId" = ${data.vehicleId}::uuid
            FOR UPDATE`;
          if (locked.length === 0) return { kind: 'expense-missing' };
          // Attachments that hold, or may yet hold, a file. FAILED ones do not count.
          count = await tx.document.count({ where: { expenseId: data.expenseId, status: live } });
        } else if (data.reminderId) {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM reminders
            WHERE id = ${data.reminderId}::uuid AND "vehicleId" = ${data.vehicleId}::uuid
            FOR UPDATE`;
          if (locked.length === 0) return { kind: 'reminder-missing' };
          count = await tx.document.count({ where: { reminderId: data.reminderId, status: live } });
        } else {
          // The vehicle is the owner of its papers. FOR UPDATE, not a shared
          // lock: two shared locks do not wait for each other, so two uploads
          // could both count 49. Held only for this count and insert.
          await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${data.vehicleId}::uuid FOR UPDATE`;
          count = await tx.document.count({
            where: { vehicleId: data.vehicleId, expenseId: null, reminderId: null, status: live },
          });
        }
        if (count >= limit) return { kind: 'limit-reached' };

        return { kind: 'created', document: await tx.document.create({ data }) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === FOREIGN_KEY_VIOLATION) {
        return { kind: 'vehicle-missing' };
      }
      throw error;
    }
  }

  /**
   * Moves a pending document on, but only if it is still pending.
   *
   * Conditional, so two confirms racing each other — a double tap, a retry —
   * cannot both act. The result says whether *this* call made the transition;
   * a caller that lost must defer to whatever the winner decided.
   */
  async settle(
    id: string,
    status: typeof DocumentStatus.READY | typeof DocumentStatus.FAILED,
  ): Promise<boolean> {
    const { count } = await this.prisma.document.updateMany({
      where: { id, status: DocumentStatus.PENDING_UPLOAD },
      data: { status },
    });
    return count === 1;
  }

  /** Ready documents only: a pending row has no file yet, and a failed one never will. */
  listReady(
    vehicleId: string,
    filter: { expenseId?: string; reminderId?: string; papers?: boolean; type?: DocumentType },
  ): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: {
        vehicleId,
        status: DocumentStatus.READY,
        ...(filter.expenseId ? { expenseId: filter.expenseId } : {}),
        ...(filter.reminderId ? { reminderId: filter.reminderId } : {}),
        ...(filter.papers ? { expenseId: null, reminderId: null } : {}),
        ...(filter.type ? { type: filter.type } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.document.delete({ where: { id } });
  }
}
