import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { oauthConfig } from '../../../config/configuration.js';
import { type OAuthConfig } from '../../../config/config.types.js';
import { GoogleProvider } from './google.provider.js';
import { type IdentityProvider } from './oauth-provider.types.js';

/**
 * The providers this deployment actually has credentials for.
 *
 * Built at construction from configuration, so an unconfigured provider does
 * not exist rather than existing and failing: `/auth/providers` omits it, the
 * button never renders, and its routes 404. Apple joins by adding one entry
 * here once its options are configured.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, IdentityProvider>();

  constructor(@Inject(oauthConfig.KEY) config: OAuthConfig) {
    if (config.google) {
      this.register(
        new GoogleProvider({
          ...config.google,
          redirectUri: `${config.apiPublicUrl}/api/v1/auth/oauth/google/callback`,
        }),
      );
    }

    this.logger.log(
      this.providers.size > 0
        ? `Identity providers enabled: ${[...this.providers.keys()].join(', ')}`
        : 'No identity providers configured; password sign-in only',
    );
  }

  private register(provider: IdentityProvider): void {
    this.providers.set(provider.slug, provider);
  }

  list(): IdentityProvider[] {
    return [...this.providers.values()];
  }

  /** Throws a 404 for a provider this deployment has not enabled. */
  require(slug: string): IdentityProvider {
    const provider = this.providers.get(slug);
    if (!provider) throw new NotFoundException(`Unknown sign-in provider: ${slug}`);
    return provider;
  }
}
