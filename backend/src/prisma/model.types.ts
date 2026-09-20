/**
 * Friendly aliases for the generated row types.
 *
 * Prisma 7's `prisma-client` generator names the plain row shape `UserModel`,
 * because `User` is taken by the query delegate. Re-exporting here keeps that
 * detail in one file instead of spreading a generator-specific naming
 * convention through every repository and mapper.
 */
export type {
  UserModel as User,
  RefreshTokenModel as RefreshToken,
  OAuthAccountModel as OAuthAccount,
} from '../generated/prisma/models.js';
