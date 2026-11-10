import type { FieldError, PageInfo } from '../../app/core/api/api-schema.gen';

/**
 * Reads and validates query parameters the way the spec describes them.
 * Collects every problem instead of stopping at the first, so the 422 response lists them all.
 *
 * @example
 * const query = new QueryReader(url.searchParams);
 * const status = query.oneOf('status', ['active', 'inactive'] as const);
 * if (query.errors.length) return ctx.validationFailed(query.errors);
 */
export class QueryReader {
  readonly errors: FieldError[] = [];

  constructor(private readonly params: URLSearchParams) {}

  /** An integer, optionally limited to a range. Returns `fallback` when missing or invalid. */
  integer(name: string, rules: { min?: number; max?: number }, fallback: number): number;
  integer(name: string, rules?: { min?: number; max?: number }): number | undefined;
  integer(name: string, rules: { min?: number; max?: number } = {}, fallback?: number) {
    const raw = this.params.get(name);
    if (raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(value)) {
      this.fail(name, 'invalid_type', 'Must be a whole number.');
      return fallback;
    }
    const { min, max } = rules;
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      this.fail(name, 'out_of_range', rangeMessage(min, max));
      return fallback;
    }
    return value;
  }

  /** One of a fixed set of values. Returns `fallback` when missing or invalid. */
  oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T;
  oneOf<T extends string>(name: string, allowed: readonly T[]): T | undefined;
  oneOf<T extends string>(name: string, allowed: readonly T[], fallback?: T) {
    const raw = this.params.get(name);
    if (raw === null || raw === '') return fallback;
    if (!(allowed as readonly string[]).includes(raw)) {
      this.fail(name, 'invalid_value', `Must be one of: ${allowed.join(', ')}.`);
      return fallback;
    }
    return raw as T;
  }

  /** The shared `page` and `pageSize` parameters, with the spec's defaults and limits. */
  pagination(): PageRequest {
    return {
      page: this.integer('page', { min: 1 }, 1),
      pageSize: this.integer('pageSize', { min: 1, max: MAX_PAGE_SIZE }, DEFAULT_PAGE_SIZE),
    };
  }

  private fail(field: string, code: string, message: string): void {
    this.errors.push({ location: 'query', field, code, message });
  }
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  pageSize: number;
}

/** Cuts one page out of a full, already filtered and sorted list. */
export function paginate<T>(
  items: readonly T[],
  { page, pageSize }: PageRequest,
): { items: T[]; page: PageInfo } {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: {
      page,
      pageSize,
      totalItems: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

/** Sorts by a spec `sort` value such as `name` or `-createdAt`. Strings compare case-insensitively. */
export function sortBy<T>(
  items: readonly T[],
  sort: string,
  fields: Record<string, (item: T) => string | number>,
): T[] {
  const descending = sort.startsWith('-');
  const key = fields[descending ? sort.slice(1) : sort];
  if (!key) return [...items];
  const direction = descending ? -1 : 1;
  return [...items].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    const order =
      typeof x === 'string' && typeof y === 'string'
        ? x.localeCompare(y, undefined, { sensitivity: 'base' })
        : Number(x) - Number(y);
    return order * direction;
  });
}

function rangeMessage(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `Must be between ${min} and ${max}.`;
  if (min !== undefined) return `Must be ${min} or more.`;
  return `Must be ${max} or less.`;
}
