import { type Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath } from '@nestjs/swagger';

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

/**
 * Documents the `{ data, meta }` envelope for a given item type.
 *
 * `@ApiOkResponse({ type: [Thing] })` would advertise a bare array, which is
 * what the endpoint *contains* rather than what it returns — so `/api/docs`
 * and every generated client would unpack the wrong shape. Decorators cannot
 * express a generic, so the schema is composed by reference instead.
 */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(PageMeta, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PageMeta) },
        },
      },
    }),
  );
