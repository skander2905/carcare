import { Module } from '@nestjs/common';
import { DigestService } from './digest.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository, DigestService],
  exports: [NotificationsService, DigestService],
})
export class NotificationsModule {}
