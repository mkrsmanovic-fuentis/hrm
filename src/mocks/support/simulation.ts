/**
 * Simulation flags let you see loading, error, access-denied and empty states without changing code.
 * Add them to the app URL, for example http://localhost:4200/?mock-error=forbidden&mock-scope=/topics.
 * They are kept for the browser tab (sessionStorage) until you open a URL with `mock-clear`.
 * See docs/developer-guide/mock-api.mdx.
 */
export interface SimulationFlags {
  /** Extra delay in milliseconds before every response. */
  delayMs?: number;
  /** Answer every request with this error status instead of the real response. */
  errorStatus?: number;
  /** List endpoints return no items. */
  empty?: boolean;
  /**
   * Moves the mock's clock by this many milliseconds, for example to see an invite or reset link
   * expire. Sessions follow the same clock, so scope it, for example to `/auth/password-resets`.
   */
  clockOffsetMs?: number;
  /** Only apply the flags to API paths that start with this, for example `/topics`. */
  scope?: string;
}

export const FLAG_PARAMS = {
  delay: 'mock-delay',
  error: 'mock-error',
  empty: 'mock-empty',
  clock: 'mock-clock',
  scope: 'mock-scope',
  reset: 'mock-reset',
  clear: 'mock-clear',
} as const;

const SLOW_DELAY_MS = 3000;

/** Units `mock-clock` takes, for example `2h`, `8d` or `-30m`. */
const CLOCK_UNITS_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Named values for `mock-error`. Any status from 400 to 599 also works. */
export const ERROR_ALIASES: Record<string, number> = {
  'bad-request': 400,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  validation: 422,
  server: 500,
};

const STORAGE_KEY = 'hrm.mockApi.flags';

/** Parses the `mock-*` query parameters. Returns `null` when the URL has none. */
export function parseFlags(search: string): SimulationFlags | null {
  const params = new URLSearchParams(search);
  const keys = [
    FLAG_PARAMS.delay,
    FLAG_PARAMS.error,
    FLAG_PARAMS.empty,
    FLAG_PARAMS.clock,
    FLAG_PARAMS.scope,
  ];
  if (!keys.some((key) => params.has(key))) return null;

  const flags: SimulationFlags = {};
  const delay = params.get(FLAG_PARAMS.delay);
  if (delay !== null) {
    const ms = delay === '' || delay === 'slow' ? SLOW_DELAY_MS : Number(delay);
    if (Number.isFinite(ms) && ms > 0) flags.delayMs = ms;
  }
  const error = params.get(FLAG_PARAMS.error);
  if (error !== null) {
    const status = ERROR_ALIASES[error || 'server'] ?? Number(error);
    if (Number.isInteger(status) && status >= 400 && status <= 599) flags.errorStatus = status;
  }
  if (params.has(FLAG_PARAMS.empty) && params.get(FLAG_PARAMS.empty) !== 'false') {
    flags.empty = true;
  }
  // A `+` in a URL reads as a space, so `+2h` arrives as ` 2h`: trim it.
  const clock = /^([+-]?\d+)([mhd])$/.exec(params.get(FLAG_PARAMS.clock)?.trim() ?? '');
  if (clock) {
    const offset = Number(clock[1]) * CLOCK_UNITS_MS[clock[2]];
    if (offset !== 0) flags.clockOffsetMs = offset;
  }
  const scope = params.get(FLAG_PARAMS.scope);
  if (scope) flags.scope = scope.startsWith('/') ? scope : `/${scope}`;
  return flags;
}

/** Whether the flags apply to a request for this API path (without the base path). */
export function flagsApplyTo(flags: SimulationFlags, apiPath: string): boolean {
  return !flags.scope || apiPath === flags.scope || apiPath.startsWith(`${flags.scope}/`);
}

/**
 * Reads the flags for this tab: flags in the URL replace the stored ones, `mock-clear` removes them.
 * Called once when the mock starts.
 */
export function loadFlags(
  location: Pick<Location, 'search'>,
  storage: Storage | null,
): SimulationFlags {
  const params = new URLSearchParams(location.search);
  if (params.has(FLAG_PARAMS.clear)) {
    storage?.removeItem(STORAGE_KEY);
    return {};
  }
  const fromUrl = parseFlags(location.search);
  if (fromUrl) {
    storage?.setItem(STORAGE_KEY, JSON.stringify(fromUrl));
    return fromUrl;
  }
  try {
    return JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as SimulationFlags;
  } catch {
    return {};
  }
}

/** One line for the console, so it is obvious when simulations are on. */
export function describeFlags(flags: SimulationFlags): string | null {
  const parts: string[] = [];
  if (flags.delayMs) parts.push(`delay ${flags.delayMs} ms`);
  if (flags.errorStatus) parts.push(`error ${flags.errorStatus}`);
  if (flags.empty) parts.push('empty lists');
  if (flags.clockOffsetMs) parts.push(`clock moved by ${flags.clockOffsetMs / 60_000} minutes`);
  if (parts.length === 0) return null;
  return `${parts.join(', ')}${flags.scope ? ` for ${flags.scope}` : ''}. Open the app with ?${FLAG_PARAMS.clear} to stop.`;
}
