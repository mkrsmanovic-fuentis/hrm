import type { Assignment, SkippedAssignment } from '../../../app/core/api/api-schema.gen';
import { recordAudit } from '../../db/audit';
import type { AssignmentRecord, MockData, UserRecord } from '../../db/mock-data';
import {
  ASSIGNMENT_SEARCH_MAX_LENGTH,
  canBeAssigned,
  hasOpenAssignment,
  matchesAssignmentSearch,
  notAssignableReason,
} from '../../rules/assignment-rules';
import { toAssignment } from '../../rules/training-rules';
import { ownRecords, requireOwnRecord, requireRole } from '../../support/access';
import { BodyReader } from '../../support/body';
import { route } from '../../support/mock-route';
import { sortBy } from '../../support/query';

const STATUSES = ['not_started', 'in_progress', 'passed', 'failed', 'overdue'] as const;
const SORTS = ['createdAt', '-createdAt', 'dueAt', '-dueAt'] as const;
/** Longest value accepted for an ID; a UUID has 36 characters. */
const ID_MAX_LENGTH = 100;
/** Longest timestamp accepted for `dueAt`. ISO 8601 with milliseconds and an offset fits. */
const TIMESTAMP_MAX_LENGTH = 40;

const sortFields = {
  createdAt: (a: Assignment) => Date.parse(a.createdAt),
  dueAt: (a: Assignment) => Date.parse(a.dueAt),
};

/**
 * Mock handlers for the Assignments tag in the spec.
 *
 * - `GET /assignments` and `GET /assignments/{assignmentId}`: administrators see every
 *   assignment, employees only their own (`ownRecords()`, `requireOwnRecord()`).
 * - `POST /assignments`: administrators assign an active questionnaire in an active topic to
 *   selected active employees, or to every active employee of an active department at this
 *   moment. Employees with an open assignment for it are skipped, not refused. Each new
 *   assignment logs one `created` audit entry and creates one `assignment_created` notification,
 *   in the same `db.update()`.
 */
export const assignmentRoutes = [
  route.get('/assignments', (ctx) => {
    const { db, now, query, page, ok, validationFailed } = ctx;
    const pagination = query.pagination();
    const questionnaireId = query.text('questionnaireId', { maxLength: ID_MAX_LENGTH });
    const userId = query.text('userId', { maxLength: ID_MAX_LENGTH });
    const departmentId = query.text('departmentId', { maxLength: ID_MAX_LENGTH });
    const status = query.oneOf('status', STATUSES);
    const search = query.text('q', { maxLength: ASSIGNMENT_SEARCH_MAX_LENGTH });
    const sort = query.oneOf('sort', SORTS, '-createdAt');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const usersById = new Map(db.data.users.map((user) => [user.id, user] as const));
    const questionnairesById = new Map(db.data.questionnaires.map((q) => [q.id, q] as const));
    const assignments = ownRecords(ctx, db.data.assignments, (a) => a.userId)
      .filter((a) => !questionnaireId || a.questionnaireId === questionnaireId)
      .filter((a) => !userId || a.userId === userId)
      .filter((a) => !departmentId || usersById.get(a.userId)?.departmentId === departmentId)
      .filter(
        (a) =>
          !search ||
          matchesAssignmentSearch(
            usersById.get(a.userId),
            questionnairesById.get(a.questionnaireId),
            search,
          ),
      )
      .map((a) => toAssignment(a, db.data, now))
      .filter((a) => !status || a.status === status);
    return ok(page(sortBy(assignments, sort, sortFields), pagination));
  }),

  route.post('/assignments', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, now, ok, validationFailed } = ctx;
    const body = new BodyReader(await ctx.json(), [
      'questionnaireId',
      'userIds',
      'departmentId',
      'dueAt',
    ]);
    const questionnaireId = body.text('questionnaireId', {
      required: true,
      maxLength: ID_MAX_LENGTH,
    });
    const rawUserIds = body.array('userIds');
    const departmentId = body.has('departmentId')
      ? body.text('departmentId', { required: true, maxLength: ID_MAX_LENGTH })
      : undefined;
    const dueAtText = body.text('dueAt', { required: true, maxLength: TIMESTAMP_MAX_LENGTH });

    if (questionnaireId !== undefined) {
      const questionnaire = db.data.questionnaires.find((q) => q.id === questionnaireId);
      const reason = questionnaire
        ? notAssignableReason(questionnaire, db.data)
        : 'Choose a questionnaire that exists.';
      if (reason) body.invalid('questionnaireId', reason);
    }

    // Exactly one of `userIds` and `departmentId`.
    if (body.has('userIds') && body.has('departmentId')) {
      body.invalid('departmentId', 'Send either userIds or departmentId, not both.');
    } else if (!body.has('userIds') && !body.has('departmentId')) {
      body.invalid('userIds', 'Choose employees or a department.');
    }

    const userIds = rawUserIds ? readUserIds(body, rawUserIds, db.data) : undefined;

    if (departmentId !== undefined) {
      const department = db.data.departments.find((d) => d.id === departmentId);
      if (!department) body.invalid('departmentId', 'Choose a department that exists.');
      else if (department.status !== 'active') {
        body.invalid('departmentId', 'Choose an active department.');
      }
    }

    let dueAt: string | undefined;
    if (dueAtText !== undefined) {
      const dueMs = Date.parse(dueAtText);
      if (Number.isNaN(dueMs)) body.invalid('dueAt', 'Must be a date and time in ISO 8601 format.');
      else if (dueMs <= now.getTime()) body.invalid('dueAt', 'Choose a deadline in the future.');
      else dueAt = new Date(dueMs).toISOString();
    }

    if (body.errors.length > 0 || questionnaireId === undefined || dueAt === undefined) {
      return validationFailed(body.errors);
    }

    // Assigning by department takes the active employees in it at this moment.
    const targets: UserRecord[] = userIds
      ? userIds.flatMap((id) => db.data.users.filter((u) => u.id === id))
      : db.data.users.filter((u) => u.departmentId === departmentId && canBeAssigned(u));

    const skipped: SkippedAssignment[] = [];
    const chosen = targets.filter((user) => {
      if (!hasOpenAssignment(user.id, questionnaireId, db.data, now)) return true;
      skipped.push({ userId: user.id, reason: 'open_assignment' });
      return false;
    });

    const created = db.update((data) => {
      const at = now.toISOString();
      return chosen.map((user) => {
        const assignment: AssignmentRecord = {
          id: crypto.randomUUID(),
          organizationId: data.organization.id,
          questionnaireId,
          userId: user.id,
          assignedById: admin.id,
          dueAt,
          createdAt: at,
          updatedAt: at,
        };
        data.assignments.push(assignment);
        data.notifications.push({
          id: crypto.randomUUID(),
          organizationId: data.organization.id,
          userId: user.id,
          type: 'assignment_created',
          assignmentId: assignment.id,
          readAt: null,
          createdAt: at,
          updatedAt: at,
        });
        recordAudit(data, {
          action: 'created',
          entityType: 'assignment',
          actorId: admin.id,
          now,
          after: assignment,
        });
        return assignment;
      });
    });

    return ok({ assignments: created.map((a) => toAssignment(a, db.data, now)), skipped }, 201);
  }),

  route.get('/assignments/{assignmentId}', (ctx) => {
    const { db, now, params, ok } = ctx;
    const assignment = requireOwnRecord(
      ctx,
      db.data.assignments.find((a) => a.id === params.assignmentId),
      (a) => a.userId,
      `Assignment ${params.assignmentId} was not found.`,
    );
    return ok(toAssignment(assignment, db.data, now));
  }),
];

/**
 * Reads `userIds`: a list of at least one ID, each an active employee. An ID listed twice counts
 * once. Returns the IDs in the order sent, or `undefined` when any is invalid.
 */
function readUserIds(
  body: BodyReader,
  raw: readonly unknown[],
  data: Pick<MockData, 'users'>,
): string[] | undefined {
  if (raw.length === 0) {
    body.invalid('userIds', 'Choose at least one employee.');
    return undefined;
  }
  const errorsBefore = body.errors.length;
  raw.forEach((value, index) => {
    const field = `userIds[${index}]`;
    if (typeof value !== 'string' || value.trim() === '' || value.length > ID_MAX_LENGTH) {
      body.invalid(field, 'Must be an ID.');
      return;
    }
    const user = data.users.find((u) => u.id === value);
    if (!user) body.invalid(field, 'Choose an employee who exists.');
    else if (user.role !== 'employee')
      body.invalid(field, 'Administrators cannot be assigned training.');
    else if (user.status !== 'active') body.invalid(field, 'Choose an active employee.');
  });
  if (body.errors.length > errorsBefore) return undefined;
  return [...new Set(raw as string[])];
}
