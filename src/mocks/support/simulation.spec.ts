import { flagsApplyTo, loadFlags, parseFlags } from './simulation';

describe('simulation flags', () => {
  it('returns null when the URL has no mock flags', () => {
    expect(parseFlags('?page=2')).toBeNull();
  });

  it('reads delays, named and numeric errors, empty lists and scope', () => {
    expect(parseFlags('?mock-delay=1500')).toEqual({ delayMs: 1500 });
    expect(parseFlags('?mock-delay=slow')).toEqual({ delayMs: 3000 });
    expect(parseFlags('?mock-error=forbidden')).toEqual({ errorStatus: 403 });
    expect(parseFlags('?mock-error')).toEqual({ errorStatus: 500 });
    expect(parseFlags('?mock-error=503')).toEqual({ errorStatus: 503 });
    expect(parseFlags('?mock-empty&mock-scope=topics')).toEqual({ empty: true, scope: '/topics' });
  });

  it('ignores values it does not understand', () => {
    expect(parseFlags('?mock-error=teapot&mock-delay=soon')).toEqual({});
  });

  it('applies scoped flags to the path and its sub-paths only', () => {
    const flags = { errorStatus: 500, scope: '/topics' };
    expect(flagsApplyTo(flags, '/topics')).toBe(true);
    expect(flagsApplyTo(flags, '/topics/123')).toBe(true);
    expect(flagsApplyTo(flags, '/topics-archive')).toBe(false);
    expect(flagsApplyTo(flags, '/organization')).toBe(false);
    expect(flagsApplyTo({ errorStatus: 500 }, '/organization')).toBe(true);
  });

  it('keeps flags for the tab until mock-clear', () => {
    const storage = sessionStorage;
    storage.clear();

    loadFlags({ search: '?mock-empty' }, storage);
    expect(loadFlags({ search: '' }, storage)).toEqual({ empty: true });

    expect(loadFlags({ search: '?mock-clear' }, storage)).toEqual({});
    expect(loadFlags({ search: '' }, storage)).toEqual({});
  });
});
