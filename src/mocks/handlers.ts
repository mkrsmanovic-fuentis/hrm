import type { HttpHandler } from 'msw';
import { unhandledApiRoute, type MockEnvironment, type MockRoute } from './support/mock-route';
import { authRoutes } from './resources/auth/auth.handlers';
import { departmentRoutes } from './resources/departments/departments.handlers';
import { organizationRoutes } from './resources/organization/organization.handlers';
import { questionnaireQuestionRoutes } from './resources/questionnaires/questionnaire-questions.handlers';
import { questionnaireRoutes } from './resources/questionnaires/questionnaires.handlers';
import { topicRoutes } from './resources/topics/topics.handlers';
import { userRoutes } from './resources/users/users.handlers';

/**
 * Every mock route, one entry per resource folder in ./resources.
 * When a feature adds a resource, it adds its routes here.
 */
export const mockRoutes: MockRoute[] = [
  ...authRoutes,
  ...organizationRoutes,
  ...departmentRoutes,
  ...userRoutes,
  ...topicRoutes,
  ...questionnaireRoutes,
  ...questionnaireQuestionRoutes,
];

/** Binds every route to an environment. The catch-all for unknown API paths comes last. */
export function createHandlers(env: MockEnvironment): HttpHandler[] {
  return [...mockRoutes, unhandledApiRoute].map((defineRoute) => defineRoute(env));
}
