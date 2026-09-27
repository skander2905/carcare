import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import { DocumentsService } from './documents.service.js';
import { DocumentResponse, DownloadUrlResponse, toDocumentResponse } from './dto/document.dto.js';
import { DocumentAccessGuard } from './guards/document-access.guard.js';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('documents')
@UseGuards(DocumentAccessGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post(':id/confirm')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish an upload once the file is in storage; safe to repeat' })
  @ApiOkResponse({ type: DocumentResponse })
  @ApiConflictResponse({ type: ApiErrorResponse, description: 'Not uploaded yet, or the upload failed.' })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<DocumentResponse> {
    return toDocumentResponse(await this.documents.confirm(access.vehicleId, id));
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'A short-lived link to view or download the file' })
  @ApiOkResponse({ type: DownloadUrlResponse })
  async downloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<DownloadUrlResponse> {
    const { url, expiresAt } = await this.documents.downloadUrl(access.vehicleId, id);
    return { url, expiresAt: expiresAt.toISOString() };
  }

  @Delete(':id')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a document and its file' })
  @ApiNoContentResponse()
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentVehicle() access: VehicleAccess,
  ): Promise<void> {
    await this.documents.remove(access.vehicleId, id);
  }
}
