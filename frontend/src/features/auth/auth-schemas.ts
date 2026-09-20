import { z } from 'zod';

/**
 * Mirrors the server's DTO rules so the user is told about a bad address or a
 * short password without a round trip.
 *
 * It is a convenience, never the enforcement: the API validates the same things
 * again, because anything a browser checks can be skipped by not using one.
 */
export const PASSWORD_MIN = 12;

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name').max(120, 'That name is too long'),
  email: z.email('Enter a valid email address').max(320),
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
    .max(128, 'That password is too long'),
});

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
