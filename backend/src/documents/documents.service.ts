import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentStatus, DocumentType } from '../generated/prisma/enums.js';
import { type Document } from '../prisma/model.types.js';
import { ObjectStorage, type PresignedUpload } from '../storage/object-storage.js';
import { purgeObjects } from '../storage/purge.js';
import { DocumentsRepository } from './documents.repository.js';
import {
  MAX_ATTACHMENTS_PER_EXPENSE,
  MAX_ATTACHMENTS_PER_REMINDER,
  MAX_CAR_PAPERS,
  type ListDocumentsQueryDto,
  type RequestUploadDto,
} from './dto/document.dto.js';

/** Long enough for a slow phone upload of a 10 MB photo; short enough to be useless if leaked. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Opened immediately by the browser, so minutes are plenty. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Receipts and invoices, uploaded straight to object storage (ADR-009).
 *
 * The API never touches the bytes. It decides who may upload what, signs a
 * URL that only accepts that, and afterwards checks the store for what
 * actually arrived before the document counts.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly documents: DocumentsRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async requestUpload(
    vehicleId: string,
    userId: string,
    dto: RequestUploadDto,
  ): Promise<{ document: Document; upload: PresignedUpload }> {
    this.requireStorage();
    if (dto.expenseId && dto.reminderId) {
      throw new BadRequestException('A file belongs to an expense or to a reminder, not both');
    }
    const limit = dto.expenseId
      ? MAX_ATTACHMENTS_PER_EXPENSE
      : dto.reminderId
        ? MAX_ATTACHMENTS_PER_REMINDER
        : MAX_CAR_PAPERS;

    const outcome = await this.documents.createWithinLimit(
      {
        vehicleId,
        uploadedById: userId,
        expenseId: dto.expenseId ?? null,
        reminderId: dto.reminderId ?? null,
        // A receipt by default when it goes with an expense; otherwise "other"
        // until the person says what the paper is.
        type: dto.type ?? (dto.expenseId ? DocumentType.RECEIPT : DocumentType.OTHER),
        title: dto.title ?? defaultTitle(dto.fileName),
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        // Generated, never derived from the file name: a name like
        // "../../other-vehicle/x" must not become a path in the bucket. Random,
        // so knowing a document's id tells you nothing about where it is stored.
        storageKey: `vehicles/${vehicleId}/documents/${randomUUID()}`,
      },
      limit,
    );

    switch (outcome.kind) {
      case 'expense-missing':
        // 404 like everything else here: an expense on another vehicle is, to
        // this request, an expense that does not exist.
        throw new NotFoundException('Expense not found');
      case 'vehicle-missing':
        throw new NotFoundException('Vehicle not found');
      case 'reminder-missing':
        throw new NotFoundException('Reminder not found');
      case 'limit-reached':
        throw new ConflictException(
          dto.expenseId
            ? `An expense can have at most ${limit} attachments`
            : dto.reminderId
              ? `A reminder can have at most ${limit} files`
              : `A car can keep at most ${limit} papers`,
        );
    }

    const { document } = outcome;

    const upload = await this.storage.presignUpload({
      key: document.storageKey,
      contentType: document.mimeType,
      sizeBytes: document.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return { document, upload };
  }

  /**
   * Marks an upload complete — after asking the store what arrived.
   *
   * The client saying "done" proves nothing: it may never have uploaded, or
   * uploaded something else. Nothing is READY until the stored object exists
   * and matches what the URL was signed for.
   */
  async confirm(vehicleId: string, id: string): Promise<Document> {
    this.requireStorage();

    const document = await this.find(vehicleId, id);

    // Confirming twice is a retry, not an error.
    if (document.status === DocumentStatus.READY) return document;
    if (document.status === DocumentStatus.FAILED) {
      throw new ConflictException('This upload failed; attach the file again');
    }

    const stored = await this.storage.head(document.storageKey);

    // Left pending rather than failed: the upload may still be in flight, or
    // the client may retry it with the same URL.
    if (!stored) throw new ConflictException('The file has not been uploaded yet');

    const matches =
      stored.sizeBytes === document.sizeBytes &&
      (stored.contentType === undefined || stored.contentType === document.mimeType);

    /*
     * Two confirms can race — a double tap, a retry — and each may have seen
     * different bytes, because the upload URL stays valid and the file can be
     * overwritten between their HEADs. Only the transition that actually
     * happened is acted on, and the loser defers to what the winner decided:
     * otherwise one confirm could mark a document READY while the other
     * deletes its file.
     */
    if (!matches) {
      // The signature should make this unreachable. If it is reached, the
      // bytes are not the ones that were approved, so they are not kept.
      if (await this.documents.settle(id, DocumentStatus.FAILED)) {
        await purgeObjects(this.storage, [document.storageKey], this.logger);
        throw new UnprocessableEntityException('The uploaded file does not match what was declared');
      }
      return this.settledElsewhere(vehicleId, id);
    }

    if (await this.documents.settle(id, DocumentStatus.READY)) return this.find(vehicleId, id);
    return this.settledElsewhere(vehicleId, id);
  }

  /** What a concurrent confirm decided, reported as if this one had decided it. */
  private async settledElsewhere(vehicleId: string, id: string): Promise<Document> {
    const current = await this.find(vehicleId, id);
    if (current.status === DocumentStatus.READY) return current;
    throw new ConflictException('This upload failed; attach the file again');
  }

  async downloadUrl(vehicleId: string, id: string): Promise<{ url: string; expiresAt: Date }> {
    this.requireStorage();

    const document = await this.find(vehicleId, id);
    if (document.status !== DocumentStatus.READY) throw new ConflictException('This file is not available');

    return this.storage.presignDownload({
      key: document.storageKey,
      fileName: document.fileName,
      contentType: document.mimeType,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  list(vehicleId: string, query: ListDocumentsQueryDto): Promise<Document[]> {
    return this.documents.listReady(vehicleId, query);
  }

  async remove(vehicleId: string, id: string): Promise<void> {
    const document = await this.find(vehicleId, id);

    await this.documents.delete(id);
    await purgeObjects(this.storage, [document.storageKey], this.logger);
  }

  private async find(vehicleId: string, id: string): Promise<Document> {
    const document = await this.documents.findInVehicle(id, vehicleId);
    // Reachable only if it was deleted between the guard and this read.
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private requireStorage(): void {
    if (!this.storage.enabled) {
      throw new ServiceUnavailableException('File storage is not configured on this server');
    }
  }
}

/** `Document.title` is VARCHAR(200); file names may run to 255. */
const TITLE_MAX_LENGTH = 200;

/**
 * The file name, cut to fit `Document.title`.
 *
 * Without the cut, a long file name and no title reached the database and
 * failed as a 500. It cuts by code point, not UTF-16 unit, so an emoji or an
 * accented letter at the boundary is dropped whole rather than split into an
 * invalid half — Postgres counts VARCHAR length in characters too.
 */
export function defaultTitle(fileName: string): string {
  return Array.from(fileName).slice(0, TITLE_MAX_LENGTH).join('');
}
