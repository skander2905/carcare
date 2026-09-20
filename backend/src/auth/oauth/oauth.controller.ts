import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Request, type Response } from 'express';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { authConfig, httpConfig, oauthConfig } from '../../config/configuration.js';
import { type AuthConfig, type HttpConfig, type OAuthConfig } from '../../config/config.types.js';
import { type IssuedSession, type SessionContext } from '../auth.service.js';
import { type AuthenticatedUser } from '../auth.types.js';
import { refreshCookieOptions } from '../cookies.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import { Public } from '../decorators/public.decorator.js';
import {
  AuthorizationUrlResponse,
  ConnectedAccountResponse,
  IdentityProviderResponse,
} from './dto/oauth.response.js';
import { OAUTH_ERRORS, OAuthService } from './oauth.service.js';

/** Starting a flow is cheap, but it writes a Redis key and hits a provider. */
const START_LIMITS = [{ scope: 'ip' as const, limit: 20, windowSec: 300 }];

@ApiTags('auth')
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    @Inject(authConfig.KEY) private readonly authOptions: AuthConfig,
    @Inject(oauthConfig.KEY) private readonly oauthOptions: OAuthConfig,
    @Inject(httpConfig.KEY) private readonly http: HttpConfig,
  ) {}

  /**
   * Lets the web app render only the buttons that will actually work.
   *
   * Without it the client would have to hard-code which providers exist, and a
   * deployment without Google credentials would show a button that dead-ends.
   */
  @Get('providers')
  @Public()
  @ApiOperation({ summary: 'Identity providers this deployment has configured' })
  @ApiOkResponse({ type: [IdentityProviderResponse] })
  providers(): IdentityProviderResponse[] {
    return this.oauth.available();
  }

  @Get('oauth/:provider')
  @Public()
  @RateLimit(...START_LIMITS)
  @ApiExcludeEndpoint()
  async start(
    @Param('provider') slug: string,
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const { authorizationUrl } = await this.oauth.start(slug, returnTo);
    // 302 rather than JSON: the browser is being handed to the provider, and a
    // fetch() cannot follow a cross-origin redirect into a login page.
    response.redirect(HttpStatus.FOUND, authorizationUrl);
  }

  /**
   * Attaches a provider to the account that is already signed in.
   *
   * Returns the authorization URL as JSON instead of redirecting, because this
   * route is authenticated with a bearer token and a top-level navigation
   * cannot carry one. The client fetches this with its token and *then*
   * navigates — which also keeps the account being linked out of the URL, where
   * anyone could otherwise nominate it.
   */
  @Get('oauth/:provider/link')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Begin attaching a provider to the authenticated account' })
  @ApiOkResponse({ type: AuthorizationUrlResponse })
  async startLink(
    @Param('provider') slug: string,
    @Query('returnTo') returnTo: string | undefined,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<AuthorizationUrlResponse> {
    const { authorizationUrl } = await this.oauth.start(slug, returnTo, current.id);
    return { authorizationUrl };
  }

  /**
   * The provider sends the browser here.
   *
   * Nothing is returned as JSON and no token appears in the URL: the session's
   * refresh cookie is set and the browser is redirected into the web app, whose
   * existing cold-load path calls `/auth/refresh` and gets an access token from
   * that cookie. A token in the query string or fragment would land in browser
   * history, and in the referrer of the next request.
   */
  @Get('oauth/:provider/callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(
    @Param('provider') slug: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // The user pressed "Cancel" on the provider's consent screen. Not an error
    // worth a message — put them back where they started.
    if (providerError) {
      response.redirect(HttpStatus.FOUND, this.webUrl('/login'));
      return;
    }

    if (!code || !state) {
      response.redirect(HttpStatus.FOUND, this.webUrl('/login', OAUTH_ERRORS.invalidState));
      return;
    }

    let result: { session?: IssuedSession; returnTo: string };

    try {
      result = await this.oauth.complete(slug, code, state, sessionContext(request));
    } catch (error) {
      // Every failure here has to become a redirect: the user is looking at a
      // browser mid-navigation, and the error envelope would render as raw JSON.
      response.redirect(HttpStatus.FOUND, this.webUrl('/login', errorCodeFor(error)));
      return;
    }

    if (result.session) this.setRefreshCookie(response, result.session);

    response.redirect(HttpStatus.FOUND, this.webUrl(result.returnTo));
  }

  @Get('oauth')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Providers connected to the authenticated account' })
  @ApiOkResponse({ type: [ConnectedAccountResponse] })
  async connected(@CurrentUser() current: AuthenticatedUser): Promise<ConnectedAccountResponse[]> {
    const accounts = await this.oauth.listForUser(current.id);

    return accounts.map((account) => ({
      provider: account.provider,
      email: account.email,
      connectedAt: account.createdAt.toISOString(),
    }));
  }

  @Delete('oauth/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disconnect a provider from the authenticated account' })
  async disconnect(
    @Param('provider') slug: string,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<void> {
    const provider = slug.toUpperCase();

    if (provider !== 'GOOGLE' && provider !== 'APPLE') {
      throw new BadRequestException(`Unknown sign-in provider: ${slug}`);
    }

    await this.oauth.unlink(current.id, provider);
  }

  // -- plumbing -------------------------------------------------------------

  /** An absolute URL back into the web app, optionally carrying an error code. */
  private webUrl(path: string, error?: string): string {
    const url = new URL(path, `${this.oauthOptions.webAppUrl}/`);
    if (error) url.searchParams.set('error', error);
    return url.toString();
  }

  private setRefreshCookie(response: Response, session: IssuedSession): void {
    const maxAgeMs = Math.max(0, session.refreshExpiresAt.getTime() - Date.now());

    response.cookie(
      this.authOptions.cookieName,
      session.refreshToken,
      refreshCookieOptions(this.authOptions, this.http.globalPrefix, maxAgeMs),
    );
  }
}

/** Maps a thrown failure onto the code the web app knows how to word. */
function errorCodeFor(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const known: readonly string[] = Object.values(OAUTH_ERRORS);

  return known.includes(message) ? message : OAUTH_ERRORS.failed;
}

function sessionContext(request: Request): SessionContext {
  const userAgent = request.get('user-agent');

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(request.ip ? { ipAddress: request.ip } : {}),
  };
}
