import { ApiProperty } from '@nestjs/swagger';

/**
 * The public projection of a user.
 *
 * Built by an explicit mapper rather than by decorating the Prisma model with
 * `@Exclude()`: an opt-out list silently leaks any column added later, while a
 * hand-written shape can only ever return the fields named here. `passwordHash`
 * cannot appear in a response by accident.
 */
export class UserResponse {
  @ApiProperty({ example: '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b', format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'sam@example.com' })
  email: string;

  @ApiProperty({ example: 'Sam Ben Ali' })
  displayName: string;

  @ApiProperty({ example: 'USER', enum: ['USER', 'ADMIN'] })
  role: string;

  @ApiProperty({ example: 'TND', description: 'ISO-4217 display currency.' })
  currency: string;

  @ApiProperty({ example: 'en' })
  locale: string;

  @ApiProperty({ example: 'Africa/Tunis' })
  timezone: string;

  @ApiProperty({ example: '2026-09-13T09:24:11.482Z' })
  createdAt: string;
}

export class AccessTokenResponse {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIs...',
    description: 'Short-lived bearer token. Hold it in memory — never in localStorage.',
  })
  accessToken: string;

  @ApiProperty({ example: 900, description: 'Seconds until the access token expires.' })
  expiresIn: number;
}

export class AuthResponse extends AccessTokenResponse {
  @ApiProperty({ type: UserResponse })
  user: UserResponse;
}
