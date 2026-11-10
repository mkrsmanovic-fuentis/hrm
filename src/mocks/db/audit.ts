import type {
  AuditAction,
  AuditChange,
  AuditEntityType,
  AuditLogEntry,
} from '../../app/core/api/api-schema.gen';
import { DERIVED_FIELDS, type MockData } from './mock-data';

/*
 * The audit log, as the mock records it. Mirrors "Audit log" in
 * docs/developer-guide/business-rules.mdx: every administrator write handler calls
 * `recordAudit()` inside the same `db.update()` that changes the record.
 */

/** A stored record that can be audited. Only `id` is required; every other field is compared. */
export type AuditedRecord = { id: string } & object;

/** Shared fields every record has. They are never listed as changes. */
const BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'organizationId',
  'createdAt',
  'updatedAt',
]);

/** A change of this field is logged as `deactivated` or `reactivated`, never as `updated`. */
const STATUS_FIELD = 'status';

interface AuditBase {
  /** The signed-in administrator who did it. Taken from the session by the handler. */
  actorId: string;
  entityType: AuditEntityType;
  /** When it happened: the handler's `now`. */
  now: Date;
}

export type AuditInput = AuditBase &
  (
    | { action: 'created'; after: AuditedRecord }
    | { action: 'updated'; before: AuditedRecord; after: AuditedRecord }
    | { action: 'deactivated' | 'reactivated'; after: AuditedRecord }
  );

/**
 * Adds the audit log entries for an administrator action and returns them, in the order they
 * were added. Call it inside `db.update()`, with the stored records before and after the change.
 *
 * - `created`: one entry listing every field the new record has a value for.
 * - `updated`: pass any edit, including one that changes `status`. Changed fields other than
 *   `status` are logged as one `updated` entry. A change of `status` is logged after it, as
 *   `deactivated` (now `inactive`) or `reactivated` (now `active`), with no changes listed.
 *   An edit that changes nothing logs nothing and returns `[]`.
 * - `deactivated` and `reactivated`: one entry with no changes listed.
 *
 * Pass stored records, not API responses: a record with a derived field such as
 * `employeeCount` throws, because derived fields never appear in `changes`.
 *
 * @example
 * db.update((data) => {
 *   const before = structuredClone(department);
 *   Object.assign(department, changes, { updatedAt: now.toISOString() });
 *   recordAudit(data, { action: 'updated', entityType: 'department', actorId, now, before, after: department });
 * });
 */
export function recordAudit(data: MockData, input: AuditInput): AuditLogEntry[] {
  const { entityType } = input;
  assertNoDerivedFields(entityType, input.after);

  switch (input.action) {
    case 'created':
      return [addEntry(data, input, 'created', auditChanges(null, input.after))];
    case 'updated': {
      assertNoDerivedFields(entityType, input.before);
      const changes = auditChanges(input.before, input.after);
      const fieldChanges = changes.filter((change) => change.field !== STATUS_FIELD);
      const statusChange = changes.find((change) => change.field === STATUS_FIELD);
      const entries: AuditLogEntry[] = [];
      if (fieldChanges.length > 0) entries.push(addEntry(data, input, 'updated', fieldChanges));
      if (statusChange) {
        const action = statusChange.newValue === 'inactive' ? 'deactivated' : 'reactivated';
        entries.push(addEntry(data, input, action, []));
      }
      return entries;
    }
    default:
      return [addEntry(data, input, input.action, [])];
  }
}

function addEntry(
  data: MockData,
  input: AuditInput,
  action: AuditAction,
  changes: AuditChange[],
): AuditLogEntry {
  const at = input.now.toISOString();
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    organizationId: data.organization.id,
    actorId: input.actorId,
    action,
    entityType: input.entityType,
    entityId: input.after.id,
    changes,
    createdAt: at,
    updatedAt: at,
  };
  data.auditLog.push(entry);
  return entry;
}

function assertNoDerivedFields(entityType: AuditEntityType, record: object): void {
  const derived: readonly string[] = DERIVED_FIELDS[entityType];
  const found = Object.keys(record).filter((field) => derived.includes(field));
  if (found.length > 0) {
    throw new Error(
      `recordAudit() got a ${entityType} with derived fields (${found.join(', ')}). ` +
        'Pass the stored record, not the API response.',
    );
  }
}

/**
 * The fields that differ between two versions of a record, as `{ field, oldValue, newValue }`.
 * A missing field counts as `null`, so for a new record (`before` is `null`) every field with a
 * value is listed. `id`, `organizationId`, `createdAt` and `updatedAt` are never listed.
 * Values are compared by content, regardless of the order of object keys, and copied, so later
 * edits to the record do not change the log.
 */
export function auditChanges(before: object | null, after: object): AuditChange[] {
  const oldRecord = (before ?? {}) as Record<string, unknown>;
  const newRecord = after as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(newRecord), ...Object.keys(oldRecord)])];

  return fields
    .filter((field) => !BOOKKEEPING_FIELDS.has(field))
    .map((field) => ({
      field,
      oldValue: copy(oldRecord[field]),
      newValue: copy(newRecord[field]),
    }))
    .filter((change) => !sameValue(change.oldValue, change.newValue));
}

/** Plain-data copy; `undefined` becomes `null`. */
function copy(value: unknown): unknown {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
}

/** Deep equality of plain JSON data. Object keys may be in any order; array order counts. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((key) => Object.hasOwn(y, key) && sameValue(x[key], y[key]))
  );
}
