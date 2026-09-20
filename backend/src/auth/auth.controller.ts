import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { ApiErrorResponse } from '../common/http/api-error.js';
import { authConfig, httpConfig } from '../config/configuration.js';
import { type AuthConfig, type HttpConfig } from '../config/config.types.js';
import { toUserResponse } from '../users/user.mapper.js';
import { AuthService, type IssuedSession, type SessionContext } from './auth.service.js';
import { type AuthenticatedUser } from './auth.types.js';
import { refreshCookieOptions } from './cookies.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { AccessTokenResponse, AuthResponse, UserResponse } from './dto/auth.response.js';
import { LoginDto, RegisterDto } from './dto/credentials.dto.js';

/**
 * Limits for the endpoints that guard the front door.
 *
 * Two scopes per endpoint on purpose: the IP rule stops one host working
 * through a password list, the email rule stops a botnet working through one
 * account from a thousand addresses. The per-email windows are longer because
 * a legitimate person does not fail to log in five times in five minutes.
 */
const LOGIN_LIMITS = [
  { scope: 'ip' as const, limit: 10, windowSec: 60 },
  { scope: 'email' as const, limit: 5, windowSec: 300 },
];

const REGISTER_LIMITS = [
  { scope: 'ip' as const, limit: 5, windowSec: 3_600 },
  { scope: 'email' as const, limit: 3, windowSec: 3_600 },
];

/** Generous: a busy tab legitimately refreshes every 15 minutes, per session. */
const REFRESH_LIMITS = [{ scope: 'ip' as const, limit: 60, windowSec: 300 }];

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(authConfig.KEY) private readonly authOptions: AuthConfig,
    @Inject(httpConfig.KEY) private readonly http: HttpConfig,
  ) {}

  @Post('register')
  @Public()
  @RateLimit(...REGISTER_LIMITS)
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiCreatedResponse({ type: AuthResponse })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.register(dto, sessionContext(request));
    return this.respondWithSession(session, response);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(...LOGIN_LIMITS)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  @ApiOkResponse({ type: AuthResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.login(dto, sessionContext(request));
    return this.respondWithSession(session, response);
  }

  /**
   * Public in the sense that it takes no bearer token — the httpOnly cookie is
   * the credential. It is how a page reload recovers a session, so requiring
   * an access token would defeat the purpose.
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit(...REFRESH_LIMITS)
  @ApiCookieAuth('refresh-token')
  @ApiOperation({ summary: 'Rotate the refresh token and mint a new access token' })
  @ApiOkResponse({ type: AccessTokenResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const presented = this.readRefreshCookie(request);

    if (!presented) {
      // Clear whatever is there: arriving without a readable cookie usually
      // means a stale one is set on a path or domain we no longer use.
      this.clearRefreshCookie(response);
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    let session: IssuedSession;
    try {
      session = await this.auth.refresh(presented, sessionContext(request));
    } catch (error) {
      // Rotation failed for good (expired, replayed, unknown). Drop the cookie
      // so the browser stops presenting a token that will never work again.
      this.clearRefreshCookie(response);
      throw error;
    }

    this.setRefreshCookie(response, session);

    // No user object here: the client already has it, and the refresh call runs
    // on every page load where the smallest useful response is the right one.
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('refresh-token')
  @ApiOperation({ summary: 'End the current session on every device sharing it' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(this.readRefreshCookie(request));
    // Cleared unconditionally: logout always succeeds from the caller's side.
    this.clearRefreshCookie(response);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'The authenticated user, read fresh from the database' })
  @ApiOkResponse({ type: UserResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  async me(@CurrentUser() current: AuthenticatedUser): Promise<UserResponse> {
    return toUserResponse(await this.auth.profile(current.id));
  }

  // -- cookie plumbing ------------------------------------------------------

  private respondWithSession(session: IssuedSession, response: Response): AuthResponse {
    this.setRefreshCookie(response, session);

    return {
      user: toUserResponse(session.user),
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    };
  }

  private readRefreshCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[this.authOptions.cookieName];
  }

  private setRefreshCookie(response: Response, session: IssuedSession): void {
    // Derived from the row's own expiry rather than recomputed, so the cookie
    // and the database agree on when the session ends.
    const maxAgeMs = Math.max(0, session.refreshExpiresAt.getTime() - Date.now());

    response.cookie(
      this.authOptions.cookieName,
      session.refreshToken,
      refreshCookieOptions(this.authOptions, this.http.globalPrefix, maxAgeMs),
    );
  }

  private clearRefreshCookie(response: Response): void {
    // Must match the path and domain the cookie was set with, or the browser
    // keeps the original and every later request presents a dead token.
    response.clearCookie(
      this.authOptions.cookieName,
      refreshCookieOptions(this.authOptions, this.http.globalPrefix),
    );
  }
}

/**
 * Recorded against the session so a user can eventually be shown "signed in
 * from Chrome on Linux, 41.226.x.x" — and so an investigation after a replay
 * detection has something to work with.
 */
function sessionContext(request: Request): SessionContext {
  const userAgent = request.get('user-agent');

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };
}
