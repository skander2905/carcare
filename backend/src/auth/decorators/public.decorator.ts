import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route out of the globally applied `JwtAuthGuard`.
 *
 * The default is deliberately the safe one: authentication is on for every
 * route, and opening one up is an explicit, greppable annotation. The opposite
 * arrangement — guard each protected route individually — makes a forgotten
 * decorator a silent data leak.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
