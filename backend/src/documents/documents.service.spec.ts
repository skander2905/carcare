import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentStatus, DocumentType } from '../generated/prisma/enums.js';
import { type Document } from '../prisma/model.types.js';
import { type ObjectStorage } from '../storage/object-storage.js';
import { type DocumentsRepository } from './documents.repository.js';
import { DocumentsService, defaultTitle } from './documents.service.js';

const VEHICLE_ID = 'vehicle-1';
const ID = 'document-1';

const doc = (status: DocumentStatus): Document =>
  ({
    id: ID,
    vehicleId: VEHICLE_ID,
    storageKey: 'vehicles/vehicle-1/documents/k',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    status,
    type: DocumentType.RECEIPT,
  }) as Document;

/**
 * Two confirms racing, driven deterministically: each test fixes what this
 * confirm saw in storage and whether its status transition won.
 */
describe('DocumentsService.confirm when another confirm got there first', () => {
  let documents: { findInVehicle: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> };
  let storage: { enabled: boolean; head: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  let service: DocumentsService;

  beforeEach(() => {
    documents = { findInVehicle: vi.fn(), settle: vi.fn() };
    storage = { enabled: true, head: vi.fn(), delete: vi.fn() };
    service = new DocumentsService(
      documents as unknown as DocumentsRepository,
      storage as unknown as ObjectStorage,
    );
  });

  it('does not delete a file the winner already marked READY', async () => {
    // This confirm saw a mismatched object (an overwrite mid-race)…
    documents.findInVehicle.mockResolvedValueOnce(doc(DocumentStatus.PENDING_UPLOAD));
    storage.head.mockResolvedValue({ sizeBytes: 9999, contentType: 'image/jpeg' });
    // …but the other confirm had already moved it to READY.
    documents.settle.mockResolvedValue(false);
    documents.findInVehicle.mockResolvedValueOnce(doc(DocumentStatus.READY));

    await expect(service.confirm(VEHICLE_ID, ID)).resolves.toMatchObject({ status: DocumentStatus.READY });
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does not report success when the winner failed the upload', async () => {
    documents.findInVehicle.mockResolvedValueOnce(doc(DocumentStatus.PENDING_UPLOAD));
    storage.head.mockResolvedValue({ sizeBytes: 1000, contentType: 'image/jpeg' });
    documents.settle.mockResolvedValue(false);
    documents.findInVehicle.mockResolvedValueOnce(doc(DocumentStatus.FAILED));

    await expect(service.confirm(VEHICLE_ID, ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes the file only when this confirm is the one that failed it', async () => {
    documents.findInVehicle.mockResolvedValue(doc(DocumentStatus.PENDING_UPLOAD));
    storage.head.mockResolvedValue({ sizeBytes: 9999, contentType: 'image/jpeg' });
    documents.settle.mockResolvedValue(true);

    await expect(service.confirm(VEHICLE_ID, ID)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(storage.delete).toHaveBeenCalledWith(['vehicles/vehicle-1/documents/k']);
  });
});

describe('defaultTitle', () => {
  it('keeps a name that fits', () => {
    expect(defaultTitle('receipt.jpg')).toBe('receipt.jpg');
  });

  it('cuts a long name to the 200 characters the column holds', () => {
    expect(defaultTitle('a'.repeat(255))).toHaveLength(200);
  });

  /** A UTF-16 cut would leave half a surrogate pair — an invalid string. */
  it('never splits a character in two at the boundary', () => {
    const title = defaultTitle(`${'a'.repeat(199)}🧾🧾`);

    expect(Array.from(title)).toHaveLength(200);
    expect(title.endsWith('🧾')).toBe(true);
  });
});
