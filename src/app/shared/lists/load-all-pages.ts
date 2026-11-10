import { EMPTY, expand, map, type Observable, reduce } from 'rxjs';
import type { PageInfo } from '../../core/api';

/** The largest page the API serves. See "Lists and pagination" in the API reference. */
export const MAX_PAGE_SIZE = 100;

/**
 * Loads every page of a list endpoint and emits all items at once. Admin list pages use it to
 * hand the full list to `sd-list`, which searches, filters and sorts in the browser.
 *
 * @example
 * loadAllPages((page) =>
 *   this.api.get('/departments', { query: { page, pageSize: MAX_PAGE_SIZE } }),
 * );
 */
export function loadAllPages<T>(
  fetchPage: (page: number) => Observable<{ items: T[]; page: PageInfo }>,
): Observable<T[]> {
  return fetchPage(1).pipe(
    expand((result) =>
      result.page.page < result.page.totalPages ? fetchPage(result.page.page + 1) : EMPTY,
    ),
    map((result) => result.items),
    reduce((all: T[], items) => [...all, ...items], []),
  );
}
