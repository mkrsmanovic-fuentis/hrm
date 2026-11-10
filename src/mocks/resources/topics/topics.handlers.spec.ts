import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import { createTestMockApi, type TestMockApiOptions } from '../../testing';

describe('topics mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    return { api: TestBed.inject(ApiClient), mock };
  }

  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('Expected the request to fail');
  }

  it('lists topics sorted by name, one page at a time', async () => {
    const { api } = setup();

    const result = await firstValueFrom(api.get('/topics', { query: { pageSize: 3, page: 2 } }));

    expect(result.items.map((topic) => topic.name)).toEqual([
      'Phishing Awareness',
      'Remote Work Security',
      'Safe Internet Usage',
    ]);
    expect(result.page).toEqual({ page: 2, pageSize: 3, totalItems: 7, totalPages: 3 });
  });

  it('filters by status and sorts descending', async () => {
    const { api, mock } = setup();
    mock.db.update((data) => {
      data.topics[0].status = 'inactive';
    });

    const active = await firstValueFrom(
      api.get('/topics', { query: { status: 'active', sort: '-name' } }),
    );

    expect(active.page.totalItems).toBe(6);
    expect(active.items[0].name).toBe('Social Engineering');
  });

  it('answers invalid query parameters with a validation problem', async () => {
    const { mock } = setup();

    const response = await mock.fetch('/api/v1/topics?pageSize=500&status=archived');
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(body).toMatchObject({ type: ProblemType.validationFailed, status: 422 });
    expect(body.errors).toEqual([
      expect.objectContaining({ location: 'query', field: 'pageSize', code: 'out_of_range' }),
      expect.objectContaining({ location: 'query', field: 'status', code: 'invalid_value' }),
    ]);
  });

  it('returns one topic by ID, and 404 for an unknown ID', async () => {
    const { api, mock } = setup();
    const topic = mock.db.data.topics[2];

    await expect(
      firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: topic.id } })),
    ).resolves.toEqual(topic);

    const error = await failure(
      firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: 'missing' } })),
    );
    expect(error.isNotFound).toBe(true);
    expect(error.problem.type).toBe(ProblemType.notFound);
  });

  it('simulates access denied with the mock-error flag', async () => {
    const { api } = setup({ flags: { errorStatus: 403 } });

    const error = await failure(firstValueFrom(api.get('/topics')));

    expect(error.isForbidden).toBe(true);
    expect(error.problem.title).toBe('Access denied');
  });

  it('simulates empty lists, only within the flag scope', async () => {
    const { api } = setup({ flags: { empty: true, scope: '/topics' } });

    const result = await firstValueFrom(api.get('/topics'));
    const organization = await firstValueFrom(api.get('/organization'));

    expect(result.items).toEqual([]);
    expect(result.page.totalPages).toBe(0);
    expect(organization.name).toBe('Brightwater Logistics');
  });

  it('answers unknown API paths with a 404 problem', async () => {
    const { mock } = setup();

    const response = await mock.fetch('/api/v1/not-a-resource');

    expect(response.status).toBe(404);
    expect((await response.json()).detail).toContain('No mock handler');
  });
});
