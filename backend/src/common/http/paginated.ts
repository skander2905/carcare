import { ApiProperty } from '@nestjs/swagger';

/**
 * The envelope every paginated list returns, as documented in api.md §5.
 *
 * Offset pagination, because the UI needs page numbers and the ability to jump.
 * Where a list is purely chronological and unbounded, cursor pagination is the
 * better fit — noted there as a future change, since offset degrades on deep
 * pages when the database still walks the skipped rows.
 */
export class PageMeta {
  @ApiProperty({ example: 2 })
  page: number;

  @ApiProperty({ example: 25 })
  limit: number;

  @ApiProperty({ example: 213 })
  total: number;

  @ApiProperty({ example: 9 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNext: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export function paginate<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data,
    meta: { page, limit, total, totalPages, hasNext: page < totalPages },
  };
}
