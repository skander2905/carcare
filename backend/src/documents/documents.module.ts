import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsRepository } from './documents.repository.js';
import { DocumentsService } from './documents.service.js';
import { DocumentAccessGuard } from './guards/document-access.guard.js';
import { VehicleDocumentsController } from './vehicle-documents.controller.js';

@Module({
  imports: [VehiclesModule],
  controllers: [VehicleDocumentsController, DocumentsController],
  providers: [DocumentsService, DocumentsRepository, DocumentAccessGuard],
})
export class DocumentsModule {}
