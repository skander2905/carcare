/** What the browser must send with its upload, exactly as signed. */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /**
   * Headers the signature covers. Sending anything else — another type, or a
   * body of another size — makes the store reject the upload, so a URL issued
   * for a 2 MB receipt cannot be used to park 2 GB of something else.
   */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | undefined;
}

export interface UploadRequest {
  key: string;
  contentType: string;
  sizeBytes: number;
  expiresInSeconds: number;
}

export interface DownloadRequest {
  key: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
}

/**
 * The object store, as far as the API cares (ADR-009).
 *
 * An abstract class rather than an interface so it can be the injection token
 * itself. `S3ObjectStorage` talks to MinIO or any S3-compatible bucket; the
 * integration suite substitutes an in-memory one, so CI needs no bucket and
 * the tests exercise the API's rules rather than a vendor's network.
 */
export abstract class ObjectStorage {
  /** False when no credentials are configured; every call then fails with 503. */
  abstract readonly enabled: boolean;

  abstract presignUpload(request: UploadRequest): Promise<PresignedUpload>;

  abstract presignDownload(request: DownloadRequest): Promise<{ url: string; expiresAt: Date }>;

  /** The stored object's real size and type, or null if nothing was uploaded. */
  abstract head(key: string): Promise<StoredObject | null>;

  /** Idempotent: deleting a key that does not exist is not an error. */
  abstract delete(keys: string[]): Promise<void>;
}

/**
 * `inline` with both an ASCII fallback and the RFC 5987 UTF-8 form.
 *
 * The file name is the uploader's, so it is never interpolated raw: a quote or
 * a newline in it would otherwise end the header value early, and non-ASCII
 * names ("reçu-garage.pdf") would be mangled by clients that only read the
 * plain `filename` parameter.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
