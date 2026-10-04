import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN, normaliseEmail } from '../dto/credentials.dto.js';

/** A random token is 43 base64url characters; the cap just refuses junk early. */
const TOKEN_MAX = 128;

export class EmailTokenDto {
  @ApiProperty({ description: 'The token from the emailed link.' })
  @IsString()
  @Length(1, TOKEN_MAX)
  token: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'sam@example.com' })
  @normaliseEmail
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(320)
  email: string;
}

export class ResetPasswordDto extends EmailTokenDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX, {
    message: `password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`,
  })
  password: string;
}
