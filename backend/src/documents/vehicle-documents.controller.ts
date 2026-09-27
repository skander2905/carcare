import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { VehicleRole } from '../generated/prisma/enums.js';
import { CurrentVehicle } from '../vehicles/decorators/vehicle-access.decorator.js';
import { MinimumVehicleRole } from '../vehicles/decorators/vehicle-role.decorator.js';
import { VehicleAccessGuard } from '../vehicles/guards/vehicle-access.guard.js';
import { type VehicleAccess } from '../vehicles/vehicle-access.types.js';
import { DocumentsService } from './documents.service.js';
import {
  DocumentResponse,
  ListDocumentsQueryDto,
  RequestUploadDto,
  UploadUrlResponse,
  toDocumentResponse,
} from './dto/document.dto.js';

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('vehicles/:vehicleId/documents')
@UseGuards(VehicleAccessGuard)
export class VehicleDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Uploaded documents, newest first; filter to one expense with ?expenseId=' })
  @ApiOkResponse({ type: [DocumentResponse] })
  async list(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @Query() query: ListDocumentsQueryDto,
  ): Promise<DocumentResponse[]> {
    return (await this.documents.list(access.vehicleId, query)).map(toDocumentResponse);
  }

  @Post('upload-url')
  @MinimumVehicleRole(VehicleRole.EDITOR)
  @ApiOperation({
    summary: 'Start an upload: returns a pending document and a presigned PUT for the file',
    description: 'PUT the file to `upload.url` with `upload.headers`, then POST /documents/:id/confirm.',
  })
  @ApiCreatedResponse({ type: UploadUrlResponse })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponse, description: 'No file storage configured.' })
  async requestUpload(
    @Param('vehicleId', ParseUUIDPipe) _vehicleId: string,
    @CurrentVehicle() access: VehicleAccess,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestUploadDto,
  ): Promise<UploadUrlResponse> {
    const { document, upload } = await this.documents.requestUpload(access.vehicleId, user.id, dto);

    return {
      document: toDocumentResponse(document),
      upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
    };
  }
}
