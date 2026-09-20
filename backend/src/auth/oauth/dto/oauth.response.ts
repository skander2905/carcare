import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IdentityProviderResponse {
  @ApiProperty({ example: 'google', description: 'Used in the URL: /auth/oauth/{slug}' })
  slug: string;

  @ApiProperty({ example: 'Google' })
  displayName: string;
}

export class ConnectedAccountResponse {
  @ApiProperty({ example: 'GOOGLE', enum: ['GOOGLE', 'APPLE'] })
  provider: string;

  @ApiPropertyOptional({
    example: 'sam@example.com',
    nullable: true,
    description: 'The address the provider last reported. Never used to resolve a sign-in.',
  })
  email: string | null;

  @ApiProperty({ example: '2026-09-20T17:24:11.482Z' })
  connectedAt: string;
}

export class AuthorizationUrlResponse {
  @ApiProperty({
    example: 'https://accounts.google.com/o/oauth2/v2/auth?...',
    description: 'Navigate the browser here. Valid for one use, for ten minutes.',
  })
  authorizationUrl: string;
}
