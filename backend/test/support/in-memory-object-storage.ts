import {
  type DownloadRequest,
  ObjectStorage,
  type PresignedUpload,
  type StoredObject,
  type UploadRequest,
} from '../../src/storage/object-storage.js';

/**
 * Object storage without a bucket, for the integration suites.
 *
 * Presigning just records what was authorised; `put` stands in for the browser
 * uploading to the signed URL. That keeps the API's own rules — who may upload,
 * what is confirmed, what is deleted and when — under test without depending
 * on MinIO being up in CI.
 */
export class InMemoryObjectStorage extends ObjectStorage {
  readonly enabled = true;

  readonly objects = new Map<string, StoredObject>();
  readonly signedUploads = new Map<string, UploadRequest>();
  readonly deleted: string[] = [];

  presignUpload(request: UploadRequest): Promise<PresignedUpload> {
    this.signedUploads.set(request.key, request);

    return Promise.resolve({
      url: `memory://upload/${request.key}`,
      method: 'PUT',
      headers: { 'Content-Type': request.contentType },
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
    });
  }

  presignDownload(request: DownloadRequest): Promise<{ url: string; expiresAt: Date }> {
    return Promise.resolve({
      url: `memory://download/${request.key}`,
      expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
    });
  }

  head(key: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(key);
      this.deleted.push(key);
    }
    return Promise.resolve();
  }

  /** The browser's upload. Defaults to exactly what was signed. */
  put(key: string, overrides: Partial<StoredObject> = {}): void {
    const signed = this.signedUploads.get(key);
    if (!signed) throw new Error(`No upload was signed for ${key}`);

    this.objects.set(key, { sizeBytes: signed.sizeBytes, contentType: signed.contentType, ...overrides });
  }

  reset(): void {
    this.objects.clear();
    this.signedUploads.clear();
    this.deleted.length = 0;
  }
}
