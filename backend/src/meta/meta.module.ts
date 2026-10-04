import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller.js';

/** Mailer and ObjectStorage come from their global modules. */
@Module({ controllers: [FeaturesController] })
export class MetaModule {}
