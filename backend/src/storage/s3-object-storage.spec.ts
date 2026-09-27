import { describe, expect, it } from 'vitest';
import { S3ObjectStorage } from './s3-object-storage.js';

/** Presigning is local computation, so these need no bucket and no network. */
const storage = new S3ObjectStorage({
  enabled: true,
  bucket: 'carcare-documents',
  region: 'us-east-1',
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test-secret' },
});

const upload = () =>
  storage.presignUpload({
    key: 'vehicles/v1/documents/k1',
    contentType: 'image/jpeg',
    sizeBytes: 250_000,
    expiresInSeconds: 900,
  });

describe('S3ObjectStorage.presignUpload', () => {
  it('signs the type and size, so the store refuses any other file', async () => {
    const { url, headers } = await upload();

    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type']));
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  /**
   * The SDK's default adds a CRC32 of the body at signing time — before the
   * body exists — so it is always the checksum of nothing. MinIO ignores it;
   * AWS S3 rejects every upload that carries it.
   */
  it('carries no checksum computed before the file exists', async () => {
    const { url } = await upload();
    expect(url).not.toMatch(/x-amz-(sdk-)?checksum/i);
  });

  /** The browser opens the URL, and it cannot resolve Compose's `minio` host. */
  it('signs for the browser-reachable endpoint', async () => {
    expect(new URL((await upload()).url).host).toBe('localhost:9000');
  });
});

describe('S3ObjectStorage without credentials', () => {
  it('reports itself disabled and refuses to sign', async () => {
    const disabled = new S3ObjectStorage({
      enabled: false,
      bucket: 'b',
      region: 'us-east-1',
      endpoint: undefined,
      publicEndpoint: undefined,
      forcePathStyle: false,
      credentials: undefined,
    });

    expect(disabled.enabled).toBe(false);
    await expect(
      disabled.presignUpload({ key: 'k', contentType: 'image/png', sizeBytes: 1, expiresInSeconds: 60 }),
    ).rejects.toThrow('not configured');
  });
});
