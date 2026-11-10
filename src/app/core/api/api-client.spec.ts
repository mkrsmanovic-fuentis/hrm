import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL, ApiClient } from './api-client';
import { ApiError, ProblemType } from './api-error';

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('prefixes the base path and fills in encoded path parameters', async () => {
    const result = firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: 'a/b' } }));

    const request = http.expectOne('/api/v1/topics/a%2Fb');
    expect(request.request.method).toBe('GET');
    request.flush({ id: 'a/b' });

    await expect(result).resolves.toEqual({ id: 'a/b' });
  });

  it('sends query parameters and leaves out undefined ones', async () => {
    const result = firstValueFrom(
      api.get('/topics', { query: { page: 2, status: undefined, sort: '-name' } }),
    );

    const request = http.expectOne((req) => req.url === '/api/v1/topics');
    expect(request.request.params.toString()).toBe('page=2&sort=-name');
    request.flush({ items: [], page: { page: 2, pageSize: 25, totalItems: 0, totalPages: 0 } });

    await result;
  });

  it('turns problem responses into an ApiError with field errors', async () => {
    const result = firstValueFrom(api.get('/topics', { query: { pageSize: 500 } }));

    http
      .expectOne((req) => req.url === '/api/v1/topics')
      .flush(
        {
          type: ProblemType.validationFailed,
          title: 'Validation failed',
          status: 422,
          errors: [
            { location: 'query', field: 'pageSize', code: 'out_of_range', message: 'Too big.' },
          ],
        },
        { status: 422, statusText: 'Unprocessable Content' },
      );

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isValidation).toBe(true);
    expect((error as ApiError).fieldErrors[0].field).toBe('pageSize');
  });

  it('rejects calls that do not match the spec at compile time', () => {
    // Never run: these lines only have to fail type checking (`pnpm typecheck`).
    const typeChecks = () => {
      // @ts-expect-error: the path is not in the spec.
      api.get('/employees');
      // @ts-expect-error: the topicId path parameter is required.
      api.get('/topics/{topicId}');
      // @ts-expect-error: `archived` is not an allowed status.
      api.get('/topics', { query: { status: 'archived' } });
      // @ts-expect-error: the spec has no POST /organization.
      api.post('/organization');
    };
    expect(typeChecks).toBeTypeOf('function');
  });

  it('turns network failures into an ApiError with status 0', async () => {
    const result = firstValueFrom(api.get('/organization'));

    http.expectOne('/api/v1/organization').error(new ProgressEvent('error'));

    const error = (await result.catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.problem.type).toBe(ProblemType.networkError);
  });
});
