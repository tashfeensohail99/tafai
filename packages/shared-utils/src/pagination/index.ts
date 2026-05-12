/**
 * @tashfeen/shared-utils — pagination/index.ts
 *
 * Pagination helpers shared across frontend and backend.
 */

import type { PaginationMeta, BaseListQuery } from '@tashfeen/shared-types';

/**
 * Build a URLSearchParams query string from a list query object.
 * Strips undefined, null, and empty-string values.
 *
 * @example
 *   buildQueryString({ page: 1, limit: 20, status: 'NEW' })
 *   // '?page=1&limit=20&status=NEW'
 */
export function buildQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Compute pagination meta from total count and current query.
 * Used by backend services to build consistent PaginationMeta responses.
 */
export function buildPaginationMeta(
  total: number,
  query: Pick<BaseListQuery, 'page' | 'limit'>,
): PaginationMeta {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const totalPages = Math.ceil(total / limit);

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Compute the skip/offset value for Prisma queries.
 */
export function paginationToSkipTake(
  query: Pick<BaseListQuery, 'page' | 'limit'>,
): { skip: number; take: number } {
  const page = Math.max(1, query.page ?? 1);
  const take = Math.min(100, Math.max(1, query.limit ?? 20));
  return { skip: (page - 1) * take, take };
}

/**
 * Validate and clamp pagination parameters.
 */
export function normalisePagination(
  page?: number,
  limit?: number,
): { page: number; limit: number } {
  return {
    page: Math.max(1, page ?? 1),
    limit: Math.min(100, Math.max(1, limit ?? 20)),
  };
}
