import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DocumentStatus, DocumentType } from '../../generated/prisma/enums.js';
import { type Document } from '../../prisma/model.types.js';

/**
 * Photos of receipts and PDFs of invoices. HEIC is what an iPhone camera
 * produces by default; refusing it would make "take a photo" fail for half the
 * people who try it.
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

/** 10 MiB: a phone photo is 2–5 MB, a scanned multi-page PDF rarely more. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Enough for any real receipt trail, few enough that a loop cannot fill a bucket. */
export const MAX_ATTACHMENTS_PER_EXPENSE = 10;
/** The same cap for a reminder's papers, and for a car's own (Phase 8). */
export const MAX_ATTACHMENTS_PER_REMINDER = 10;
export const MAX_CAR_PAPERS = 50;

const trimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

export class RequestUploadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Attach to this expense. It must belong to the vehicle.',
  })
  @IsOptional()
  @IsUUID()
  expenseId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Keep with this reminder, e.g. the insurance certificate. Not together with expenseId.',
  })
  @IsOptional()
  @IsUUID()
  reminderId?: string;

  @ApiPropertyOptional({
    enum: DocumentType,
    default: DocumentType.RECEIPT,
    description: "With neither expenseId nor reminderId, the file is one of the car's papers.",
  })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional({ maxLength: 200, description: 'Defaults to the file name.' })
  @IsOptional()
  @trimmed
  @IsString()
  @Length(1, 200)
  title?: string;

  @ApiProperty({ example: 'receipt-agil.jpg', maxLength: 255 })
  @trimmed
  @IsString()
  @Length(1, 255)
  fileName: string;

  @ApiProperty({ enum: ALLOWED_MIME_TYPES, example: 'image/jpeg' })
  @IsIn(ALLOWED_MIME_TYPES, { message: 'Attach a photo (JPEG, PNG, WebP, HEIC) or a PDF' })
  mimeType: (typeof ALLOWED_MIME_TYPES)[number];

  @ApiProperty({ example: 2_400_000, maximum: MAX_DOCUMENT_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES, { message: 'Files can be at most 10 MB' })
  sizeBytes: number;
}

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  expenseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reminderId?: string;

  @ApiPropertyOptional({ description: "Only the car's own papers: files kept with no expense or reminder." })
  @IsOptional()
  // A query string is text: "false" must not become true.
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  papers?: boolean;

  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}

export class DocumentResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  expenseId: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reminderId: string | null;

  @ApiProperty({ enum: DocumentType })
  type: DocumentType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 2_400_000 })
  sizeBytes: number;

  @ApiProperty({ enum: DocumentStatus })
  status: DocumentStatus;

  @ApiProperty()
  createdAt: string;
}

export class PresignedUploadResponse {
  @ApiProperty()
  url: string;

  @ApiProperty({ example: 'PUT' })
  method: 'PUT';

  @ApiProperty({
    description: 'Send exactly these headers with the file as the body; the signature covers them.',
    example: { 'Content-Type': 'image/jpeg' },
  })
  headers: Record<string, string>;

  @ApiProperty()
  expiresAt: string;
}

export class UploadUrlResponse {
  @ApiProperty({ type: DocumentResponse })
  document: DocumentResponse;

  @ApiProperty({ type: PresignedUploadResponse })
  upload: PresignedUploadResponse;
}

export class DownloadUrlResponse {
  @ApiProperty({ description: 'Short-lived. Fetch a new one rather than storing it.' })
  url: string;

  @ApiProperty()
  expiresAt: string;
}

export function toDocumentResponse(document: Document): DocumentResponse {
  return {
    id: document.id,
    vehicleId: document.vehicleId,
    expenseId: document.expenseId,
    reminderId: document.reminderId,
    type: document.type,
    title: document.title,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
  };
}
