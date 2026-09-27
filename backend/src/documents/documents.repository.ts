import { Injectable } from '@nestjs/common';
import { type Prisma } from '../generated/prisma/client.js';
import { DocumentStatus, type DocumentType } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Document } from '../prisma/model.types.js';

export type NewDocument = Omit<
  Prisma.DocumentUncheckedCreateInput,
  'id' | 'status' | 'createdAt' | 'updatedAt'
>;

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

  expenseInVehicle(expenseId: string, vehicleId: string): Promise<{ id: string } | null> {
    return this.prisma.expense.findFirst({ where: { id: expenseId, vehicleId }, select: { id: true } });
  }

  /** Attachments that hold, or may yet hold, a file. FAILED ones do not count. */
  countLiveForExpense(expenseId: string): Promise<number> {
    return this.prisma.document.count({
      where: { expenseId, status: { in: [DocumentStatus.PENDING_UPLOAD, DocumentStatus.READY] } },
    });
  }

  create(data: NewDocument): Promise<Document> {
    return this.prisma.document.create({ data });
  }

  /**
   * Moves a pending document on, but only if it is still pending.
   *
   * Conditional, so two confirms racing each other — a double tap, a retry —
   * cannot both act: the second finds nothing to update and reads the result.
   */
  async settle(id: string, status: DocumentStatus): Promise<boolean> {
    const { count } = await this.prisma.document.updateMany({
      where: { id, status: DocumentStatus.PENDING_UPLOAD },
      data: { status },
    });
    return count === 1;
  }

  /** Ready documents only: a pending row has no file yet, and a failed one never will. */
  listReady(vehicleId: string, filter: { expenseId?: string; type?: DocumentType }): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: {
        vehicleId,
        status: DocumentStatus.READY,
        ...(filter.expenseId ? { expenseId: filter.expenseId } : {}),
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
