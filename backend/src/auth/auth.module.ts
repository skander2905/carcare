import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { authConfig } from '../config/configuration.js';
import { type AuthConfig } from '../config/config.types.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OAuthAccountRepository } from './oauth/oauth-account.repository.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthService } from './oauth/oauth.service.js';
import { OAuthStateService } from './oauth/oauth-state.service.js';
import { ProviderRegistry } from './oauth/providers/provider.registry.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    UsersModule,
    PassportModule,

    // Signing options live here so every `signAsync` call gets the issuer,
    // audience and expiry without repeating them — and cannot accidentally
    // mint a token that omits one.
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (auth: AuthConfig) => ({
        secret: auth.accessSecret,
        signOptions: {
          algorithm: 'HS256',
          // The env schema already validates this as an `ms` duration.
          // `JwtSignOptions` types it as the `ms` package's template-literal
          // union, which a runtime-validated string cannot narrow to by itself.
          expiresIn: auth.accessTtl as JwtSignOptions['expiresIn'],
          issuer: auth.issuer,
          audience: auth.audience,
        },
      }),
    }),
  ],
  controllers: [AuthController, OAuthController],
  providers: [
    AuthService,
    RefreshTokenRepository,
    JwtStrategy,

    OAuthService,
    OAuthStateService,
    OAuthAccountRepository,
    ProviderRegistry,

    /*
     * Both guards are global, and the order of this array is the order they
     * run in.
     *
     * Rate limiting comes first on purpose: an unauthenticated flood must be
     * rejected before it costs a signature verification, and the login
     * endpoint — the one most worth limiting — is public, so a guard running
     * after authentication would never see it.
     */
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
