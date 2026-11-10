/*
 * Department rules the mock applies, mirrored from the "Departments" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { Department, User } from '../../app/core/api/api-schema.gen';
import type { DepartmentRecord } from '../db/mock-data';

export const DEPARTMENT_NAME_MAX_LENGTH = 100;
export const DEPARTMENT_DESCRIPTION_MAX_LENGTH = 500;

/** `employeeCount`: active users whose `departmentId` is this department. */
export function employeeCount(
  departmentId: string,
  users: readonly Pick<User, 'departmentId' | 'status'>[],
): number {
  return users.filter((user) => user.departmentId === departmentId && user.status === 'active')
    .length;
}

/** The API's `Department`: the stored record plus its derived `employeeCount`. */
export function toDepartment(
  record: DepartmentRecord,
  users: readonly Pick<User, 'departmentId' | 'status'>[],
): Department {
  return { ...record, employeeCount: employeeCount(record.id, users) };
}

/**
 * Names are unique within the organization, among active and inactive departments, ignoring
 * upper and lower case and spaces around them.
 */
export function isSameDepartmentName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
