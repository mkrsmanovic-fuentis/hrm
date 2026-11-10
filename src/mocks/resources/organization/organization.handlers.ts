import { route } from '../../support/mock-route';

/** Mock handlers for the Organization tag in the spec. */
export const organizationRoutes = [
  route.get('/organization', ({ db, ok }) => ok(db.data.organization)),
];
