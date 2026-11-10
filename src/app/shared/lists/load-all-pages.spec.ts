import { firstValueFrom, of } from 'rxjs';
import { loadAllPages } from './load-all-pages';

describe('loadAllPages', () => {
  const pages = [['a', 'b'], ['c', 'd'], ['e']];

  function fetchPage(page: number) {
    return of({
      items: pages[page - 1],
      page: { page, pageSize: 2, totalItems: 5, totalPages: pages.length },
    });
  }

  it('loads every page in order', async () => {
    const fetch = vi.fn(fetchPage);

    await expect(firstValueFrom(loadAllPages(fetch))).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetch.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it('emits an empty list when there are no items', async () => {
    const empty = () =>
      of({ items: [], page: { page: 1, pageSize: 2, totalItems: 0, totalPages: 0 } });

    await expect(firstValueFrom(loadAllPages(empty))).resolves.toEqual([]);
  });
});
