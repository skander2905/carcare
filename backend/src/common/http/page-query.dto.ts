import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** `page` and `limit`, validated and defaulted, for every paginated list. */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, maximum: MAX_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // Capped server-side so a client cannot ask for everything at once.
  @Max(MAX_PAGE_LIMIT)
  limit = DEFAULT_PAGE_LIMIT;
}
