import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

/**
 * Lower-cases and trims on the way in.
 *
 * The uniqueness constraint is on the stored column, so normalising at the edge
 * is what stops `Sam@example.com` and `sam@example.com` becoming two accounts
 * that both believe they own the address.
 */
const normaliseEmail = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value,
);

const trimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** 320 is the maximum length of an email address per RFC 3696 erratum 1690. */
const EMAIL_MAX = 320;

/**
 * Twelve characters, and no composition rules.
 *
 * Current NIST guidance is that length beats forced symbol classes, which
 * mostly produce `Password1!` and a reset request a month later. Long
 * passphrases are accepted, so the upper bound only exists to stop a
 * megabyte-long body costing real CPU in Argon2.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** The one field both credential payloads share. */
class EmailCredential {
  @ApiProperty({ example: 'sam@example.com', maxLength: EMAIL_MAX })
  @normaliseEmail
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(EMAIL_MAX)
  email: string;
}

export class LoginDto extends EmailCredential {
  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  // Deliberately not length-validated on login: the rule may have changed since
  // the account was created, and rejecting a short-but-correct password here
  // would lock out an existing user. Verification is the only check that counts.
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class RegisterDto extends EmailCredential {
  @ApiProperty({ example: 'correct horse battery staple', minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX, {
    message: `password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`,
  })
  password: string;

  @ApiProperty({ example: 'Sam Ben Ali', minLength: 1, maxLength: 120 })
  @trimmed
  @IsString()
  @Length(1, 120)
  displayName: string;
}
