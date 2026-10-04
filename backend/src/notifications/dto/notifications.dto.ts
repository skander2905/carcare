import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../common/http/page-query.dto.js';
import { NotificationType } from '../../generated/prisma/enums.js';
import { type Notification } from '../../prisma/model.types.js';
import { notificationPath } from '../notification-links.js';

export class ListNotificationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  // A query string is text: "false" must not become true.
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unreadOnly = false;
}

export class NotificationResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  vehicleId: string | null;

  @ApiProperty({ example: 'Oil and filter is due soon · Peugeot 208' })
  title: string;

  @ApiProperty({ example: 'Due in 820 km or in 12 days.' })
  body: string;

  @ApiProperty({
    example: '/vehicles/0192…/maintenance',
    description: 'Where in the web app to deal with it.',
  })
  path: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { status: 'DUE_SOON', scheduleId: '0192…' },
  })
  data: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true })
  readAt: string | null;

  @ApiProperty()
  createdAt: string;
}

export function toNotificationResponse(n: Notification): NotificationResponse {
  return {
    id: n.id,
    type: n.type,
    vehicleId: n.vehicleId,
    title: n.title,
    body: n.body,
    path: notificationPath(n.type, n.data, n.vehicleId),
    data: typeof n.data === 'object' && n.data !== null && !Array.isArray(n.data) ? n.data : {},
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export class UnreadCountResponse {
  @ApiProperty({ example: 3 })
  count: number;
}

export class MarkAllReadResponse {
  @ApiProperty({ example: 3, description: 'How many were unread.' })
  updated: number;
}
