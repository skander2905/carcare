import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { storageConfig } from '../config/configuration.js';
import { type StorageConfig } from '../config/config.types.js';
import {
  type DownloadRequest,
  ObjectStorage,
  type PresignedUpload,
  type StoredObject,
  type UploadRequest,
  contentDisposition,
} from './object-storage.js';

@Injectable()
export class S3ObjectStorage extends ObjectStorage implements OnModuleDestroy {
  readonly enabled: boolean;

  /** Reaches the store from the API: HEAD and DELETE. */
  private readonly internal: S3Client | null;
  /**
   * Signs URLs the browser will open. A separate client because the host is
   * part of the signature: inside Compose the API calls `minio:9000`, which no
   * browser can resolve, so a URL signed for it is useless and one re-pointed
   * afterwards no longer verifies.
   */
  private readonly signer: S3Client | null;

  constructor(@Inject(storageConfig.KEY) private readonly config: StorageConfig) {
    super();
    this.enabled = config.enabled;
    this.internal = config.enabled ? this.client(config.endpoint) : null;
    this.signer = config.enabled ? this.client(config.publicEndpoint) : null;
  }

  async presignUpload({
    key,
    contentType,
    sizeBytes,
    expiresInSeconds,
  }: UploadRequest): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.require(this.signer),
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      {
        expiresIn: expiresInSeconds,
        // Signed as headers, not hoisted into the query string, so the store
        // checks the body the browser actually sends against the declared
        // type and size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );

    return {
      url,
      method: 'PUT',
      // Content-Length is set by the browser from the body; it cannot be
      // sent by script, and is signed so a different-sized body fails.
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  async presignDownload({ key, fileName, contentType, expiresInSeconds }: DownloadRequest) {
    const url = await getSignedUrl(
      this.require(this.signer),
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: contentDisposition(fileName),
      }),
      { expiresIn: expiresInSeconds },
    );

    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.require(this.internal).send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof NotFound) return null;
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return null;
      throw error;
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    await this.require(this.internal).send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  onModuleDestroy(): void {
    this.internal?.destroy();
    this.signer?.destroy();
  }

  private client(endpoint: string | undefined): S3Client {
    return new S3Client({
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      ...(endpoint ? { endpoint } : {}),
      ...(this.config.credentials ? { credentials: this.config.credentials } : {}),
    });
  }

  private require(client: S3Client | null): S3Client {
    if (!client) throw new ServiceUnavailableException('File storage is not configured on this server');
    return client;
  }
}
