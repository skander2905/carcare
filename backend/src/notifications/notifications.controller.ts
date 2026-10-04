import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { mailConfig } from '../config/configuration.js';
import { type MailConfig } from '../config/config.types.js';
import { verifyUnsubscribe } from './domain/unsubscribe-link.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { ApiPaginatedResponse, type Paginated, paginate } from '../common/http/paginated.js';
import {
  ListNotificationsQueryDto,
  MarkAllReadResponse,
  NotificationResponse,
  UnreadCountResponse,
  toNotificationResponse,
} from './dto/notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The caller's own inbox. Notifications belong to a user, not a vehicle, so
 * there is no membership guard: every query is scoped by the caller's id, and
 * someone else's notification is simply not found.
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(mailConfig.KEY) private readonly mail: MailConfig,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications, newest first' })
  @ApiPaginatedResponse(NotificationResponse)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    const { notifications, total } = await this.notifications.list(user.id, query);
    return paginate(notifications.map(toNotificationResponse), total, query.page, query.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many are unread — cheap enough to poll for the badge' })
  @ApiOkResponse({ type: UnreadCountResponse })
  async unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountResponse> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one read; reading it again keeps the first time' })
  @ApiOkResponse({ type: NotificationResponse })
  @ApiNotFoundResponse({ type: ApiErrorResponse, description: 'Absent, or not yours.' })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return toNotificationResponse(await this.notifications.markRead(user.id, id));
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  @ApiOkResponse({ type: MarkAllReadResponse })
  async markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<MarkAllReadResponse> {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  /**
   * The "stop these emails" link, which must work without signing in.
   *
   * POST, never GET: mail scanners open every link in a message, and a GET
   * that changed something would unsubscribe people who never clicked. Gmail's
   * own button POSTs here directly (RFC 8058); the link in the email body
   * opens a page in the web app with a button that does the same.
   */
  @Post('unsubscribe')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ scope: 'ip', limit: 20, windowSec: 3_600 })
  @ApiOperation({ summary: 'Turn reminder emails off, from a signed link; no sign-in needed' })
  @ApiOkResponse({ schema: { example: { unsubscribed: true } } })
  async unsubscribe(@Query('token') token: unknown): Promise<{ unsubscribed: true }> {
    const userId = typeof token === 'string' ? verifyUnsubscribe(token, this.mail.linkSigningKey) : null;
    if (!userId)
      throw new BadRequestException('This link is not valid. You can turn emails off in Settings.');
    await this.notifications.unsubscribe(userId);
    return { unsubscribed: true };
  }
}
