import type { Department } from '../../../app/core/api/api-schema.gen';
import { recordAudit } from '../../db/audit';
import type { DepartmentRecord } from '../../db/mock-data';
import {
  DEPARTMENT_DESCRIPTION_MAX_LENGTH,
  DEPARTMENT_NAME_MAX_LENGTH,
  isSameDepartmentName,
  toDepartment,
} from '../../rules/department-rules';
import { requireRole } from '../../support/access';
import { BodyReader, notUnique } from '../../support/body';
import type { MockDb } from '../../db/mock-db';
import { route } from '../../support/mock-route';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const SORTS = [
  'name',
  '-name',
  'employeeCount',
  '-employeeCount',
  'createdAt',
  '-createdAt',
] as const;

const sortFields = {
  name: (department: Department) => department.name,
  employeeCount: (department: Department) => department.employeeCount,
  createdAt: (department: Department) => Date.parse(department.createdAt),
};

/**
 * Mock handlers for the Departments tag in the spec. Administrators only: every route calls
 * `requireRole()` first. The write routes are the reference for administrator create and edit
 * handlers: validate the whole body, answer a duplicate name with `409`, change data and log it
 * in one `db.update()`, and return the record as the API shows it.
 */
export const departmentRoutes = [
  route.get('/departments', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, query, page, ok, validationFailed } = ctx;
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const search = query.text('q', { maxLength: DEPARTMENT_NAME_MAX_LENGTH })?.toLowerCase();
    const sort = query.oneOf('sort', SORTS, 'name');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const departments = db.data.departments
      .filter((department) => !status || department.status === status)
      .filter((department) => !search || department.name.toLowerCase().includes(search))
      .map((department) => toDepartment(department, db.data.users));
    return ok(page(sortBy(departments, sort, sortFields), pagination));
  }),

  route.post('/departments', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, now, ok, validationFailed } = ctx;
    const body = new BodyReader(await ctx.json(), ['name', 'description']);
    const name = body.text('name', { required: true, maxLength: DEPARTMENT_NAME_MAX_LENGTH });
    const description = body.nullableText('description', {
      maxLength: DEPARTMENT_DESCRIPTION_MAX_LENGTH,
    });
    if (body.errors.length > 0 || name === undefined) return validationFailed(body.errors);
    requireUniqueName(db, name);

    const created = db.update((data) => {
      const at = now.toISOString();
      const department: DepartmentRecord = {
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        name,
        description: description ?? null,
        status: 'active',
        createdAt: at,
        updatedAt: at,
      };
      data.departments.push(department);
      recordAudit(data, {
        action: 'created',
        entityType: 'department',
        actorId: admin.id,
        now,
        after: department,
      });
      return department;
    });
    return ok(toDepartment(created, db.data.users), 201);
  }),

  route.get('/departments/{departmentId}', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, params, ok, notFound } = ctx;
    const department = db.data.departments.find((d) => d.id === params.departmentId);
    return department
      ? ok(toDepartment(department, db.data.users))
      : notFound(`Department ${params.departmentId} was not found.`);
  }),

  route.patch('/departments/{departmentId}', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound, validationFailed } = ctx;
    const department = db.data.departments.find((d) => d.id === params.departmentId);
    if (!department) return notFound(`Department ${params.departmentId} was not found.`);

    const body = new BodyReader(await ctx.json(), ['name', 'description', 'status']);
    const name = body.text('name', { maxLength: DEPARTMENT_NAME_MAX_LENGTH });
    const description = body.nullableText('description', {
      maxLength: DEPARTMENT_DESCRIPTION_MAX_LENGTH,
    });
    const status = body.oneOf('status', STATUSES);
    if (body.errors.length > 0) return validationFailed(body.errors);
    if (name !== undefined) requireUniqueName(db, name, department.id);

    const changes: Partial<DepartmentRecord> = {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
    };
    const updated = db.update((data) => {
      const before = structuredClone(department);
      Object.assign(department, changes);
      // Logs `updated` for name and description, and `deactivated` or `reactivated` for status.
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'department',
        actorId: admin.id,
        now,
        before,
        after: department,
      });
      if (entries.length > 0) department.updatedAt = now.toISOString();
      return department;
    });
    return ok(toDepartment(updated, db.data.users));
  }),
];

/** Answers `409` when another department already has the name. */
function requireUniqueName(db: MockDb, name: string, exceptId?: string): void {
  const taken = db.data.departments.some(
    (other) => other.id !== exceptId && isSameDepartmentName(other.name, name),
  );
  if (taken) {
    throw notUnique(
      'name',
      'A department with this name already exists.',
      `A department named ${name} already exists.`,
    );
  }
}
