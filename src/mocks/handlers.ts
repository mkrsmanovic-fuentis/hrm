import type { HttpHandler } from 'msw';
import { unhandledApiRoute, type MockEnvironment, type MockRoute } from './support/mock-route';
import { organizationRoutes } from './resources/organization/organization.handlers';
import { topicRoutes } from './resources/topics/topics.handlers';

/**
 * Every mock route, one entry per resource folder in ./resources.
 * When a feature adds a resource, it adds its routes here.
 */
export const mockRoutes: MockRoute[] = [...organizationRoutes, ...topicRoutes];

/** Binds every route to an environment. The catch-all for unknown API paths comes last. */
export function createHandlers(env: MockEnvironment): HttpHandler[] {
  return [...mockRoutes, unhandledApiRoute].map((defineRoute) => defineRoute(env));
}
