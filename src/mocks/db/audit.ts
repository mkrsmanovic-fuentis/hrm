import type {
  AuditChange,
  AuditEntityType,
  AuditLogEntry,
} from '../../app/core/api/api-schema.gen';
import type { MockData } from './mock-data';

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
 * Adds an audit log entry for an administrator action and returns it. Call it inside
 * `db.update()`, with the stored records before and after the change.
 *
 * - `created`: lists every field the new record has a value for.
 * - `updated`: lists only the fields that changed. Returns `null` and records nothing when no
 *   field changed.
 * - `deactivated` and `reactivated`: no changes listed; the action says what happened.
 *
 * @example
 * db.update((data) => {
 *   const before = structuredClone(topic);
 *   Object.assign(topic, body, { updatedAt: now.toISOString() });
 *   recordAudit(data, { action: 'updated', entityType: 'topic', actorId, now, before, after: topic });
 * });
 */
export function recordAudit(data: MockData, input: AuditInput): AuditLogEntry | null {
  const changes = changesFor(input);
  if (input.action === 'updated' && changes.length === 0) return null;

  const at = input.now.toISOString();
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    organizationId: data.organization.id,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.after.id,
    changes,
    createdAt: at,
    updatedAt: at,
  };
  data.auditLog.push(entry);
  return entry;
}

function changesFor(input: AuditInput): AuditChange[] {
  switch (input.action) {
    case 'created':
      return auditChanges(null, input.after);
    case 'updated':
      return auditChanges(input.before, input.after);
    default:
      return [];
  }
}

/**
 * The fields that differ between two versions of a record, as `{ field, oldValue, newValue }`.
 * A missing field counts as `null`, so for a new record (`before` is `null`) every field with a
 * value is listed. `id`, `organizationId`, `createdAt` and `updatedAt` are never listed.
 * Values are copied, so later edits to the record do not change the log.
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

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
