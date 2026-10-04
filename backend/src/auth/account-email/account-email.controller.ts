import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ApiErrorResponse } from '../../common/http/api-error.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { type AuthenticatedUser } from '../auth.types.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { Public } from '../decorators/public.decorator.js';
import { AccountEmailService } from './account-email.service.js';
import { EmailTokenDto, ForgotPasswordDto, ResetPasswordDto } from './account-email.dto.js';

/** Each sends an email, so each is limited: an open endpoint that mails anyone is a spam cannon. */
const RESEND_LIMITS = [{ scope: 'ip' as const, limit: 5, windowSec: 3_600 }];
const FORGOT_LIMITS = [
  { scope: 'ip' as const, limit: 5, windowSec: 3_600 },
  { scope: 'email' as const, limit: 3, windowSec: 3_600 },
];
const TOKEN_LIMITS = [{ scope: 'ip' as const, limit: 20, windowSec: 3_600 }];

@ApiTags('auth')
@Controller('auth')
export class AccountEmailController {
  constructor(private readonly accountEmail: AccountEmailService) {}

  @Post('email/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(...TOKEN_LIMITS)
  @ApiOperation({ summary: 'Confirm an email address with the token from the emailed link' })
  @ApiOkResponse({ schema: { example: { verified: true } } })
  @ApiBadRequestResponse({ type: ApiErrorResponse, description: 'Expired, used, or not a token.' })
  async verify(@Body() dto: EmailTokenDto): Promise<{ verified: true }> {
    await this.accountEmail.verify(dto.token);
    return { verified: true };
  }

  @Post('email/verify/resend')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(...RESEND_LIMITS)
  @ApiOperation({ summary: 'Send the confirmation email again; nothing happens once confirmed' })
  @ApiAcceptedResponse()
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse })
  async resend(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.accountEmail.resendVerification(user.id);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(...FORGOT_LIMITS)
  @ApiOperation({
    summary: 'Email a reset link, if the address has an account. The answer is the same either way.',
  })
  @ApiAcceptedResponse()
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse })
  async forgot(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.accountEmail.forgotPassword(dto.email);
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(...TOKEN_LIMITS)
  @ApiOperation({
    summary: 'Set a new password with the token from the emailed link; signs out every session',
  })
  @ApiOkResponse({ schema: { example: { reset: true } } })
  @ApiBadRequestResponse({ type: ApiErrorResponse, description: 'Expired, used, or a password too short.' })
  async reset(@Body() dto: ResetPasswordDto): Promise<{ reset: true }> {
    await this.accountEmail.resetPassword(dto.token, dto.password);
    return { reset: true };
  }
}
