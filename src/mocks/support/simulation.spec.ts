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

  it('reads a clock offset in minutes, hours or days, with or without a sign', () => {
    expect(parseFlags('?mock-clock=90m')).toEqual({ clockOffsetMs: 90 * 60_000 });
    expect(parseFlags('?mock-clock=2h')).toEqual({ clockOffsetMs: 2 * 3_600_000 });
    // A `+` in a URL arrives as a space.
    expect(parseFlags('?mock-clock=+8d')).toEqual({ clockOffsetMs: 8 * 86_400_000 });
    expect(parseFlags('?mock-clock=-1h&mock-scope=/auth')).toEqual({
      clockOffsetMs: -3_600_000,
      scope: '/auth',
    });
    expect(parseFlags('?mock-clock=soon')).toEqual({});
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
