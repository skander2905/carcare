import { Global, Module } from '@nestjs/common';
import { ObjectStorage } from './object-storage.js';
import { S3ObjectStorage } from './s3-object-storage.js';

/**
 * Global, like PrismaModule: storage is infrastructure, and every feature that
 * attaches files — expenses now, maintenance and documents later — uses the
 * same bucket through the same contract.
 */
@Global()
@Module({
  providers: [{ provide: ObjectStorage, useClass: S3ObjectStorage }],
  exports: [ObjectStorage],
})
export class StorageModule {}
