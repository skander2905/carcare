import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

const trimmed = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/**
 * Currencies the product actually supports today. An allow-list rather than a
 * free-text ISO code, because every value here has to be formattable and, once
 * conversion exists (ADR-016), have a rate source.
 */
export const SUPPORTED_CURRENCIES = ['TND', 'EUR', 'USD', 'GBP'] as const;
export const SUPPORTED_LOCALES = ['en', 'fr', 'ar'] as const;

/**
 * Every field is optional — this is a PATCH. `email` and `role` are absent on
 * purpose: changing an address needs a verification flow, and letting a user
 * PATCH their own role is privilege escalation in one line.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Sam Ben Ali', minLength: 1, maxLength: 120 })
  @IsOptional()
  @trimmed
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @ApiPropertyOptional({ example: 'TND', enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: (typeof SUPPORTED_CURRENCIES)[number];

  @ApiPropertyOptional({ example: 'en', enum: SUPPORTED_LOCALES })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: (typeof SUPPORTED_LOCALES)[number];

  @ApiPropertyOptional({ example: 'Africa/Tunis', maxLength: 64 })
  @IsOptional()
  @trimmed
  @IsString()
  @Length(1, 64)
  // IANA zone names: "Area/Location", optionally three segments ("America/Argentina/Salta").
  @Matches(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/, {
    message: 'timezone must be an IANA time zone name, for example Africa/Tunis',
  })
  timezone?: string;
}
