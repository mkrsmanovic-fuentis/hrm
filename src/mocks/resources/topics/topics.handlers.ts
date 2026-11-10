import type { Topic } from '../../../app/core/api/api-schema.gen';
import { canSeeTopic } from '../../rules/access-rules';
import { signedInUser } from '../../support/access';
import { route } from '../../support/mock-route';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const SORTS = ['name', '-name', 'createdAt', '-createdAt'] as const;

const sortFields = {
  name: (topic: Topic) => topic.name,
  createdAt: (topic: Topic) => Date.parse(topic.createdAt),
};

/**
 * Mock handlers for the Topics tag in the spec. Both roles can read topics; employees only see
 * active ones (see the access rules in docs/developer-guide/business-rules.mdx).
 */
export const topicRoutes = [
  route.get('/topics', (ctx) => {
    const { db, query, page, ok, validationFailed } = ctx;
    const user = signedInUser(ctx);
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const sort = query.oneOf('sort', SORTS, 'name');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const topics = db.data.topics.filter(
      (topic) => canSeeTopic(user, topic) && (!status || topic.status === status),
    );
    return ok(page(sortBy(topics, sort, sortFields), pagination));
  }),

  route.get('/topics/{topicId}', (ctx) => {
    const { db, params, ok, notFound } = ctx;
    const user = signedInUser(ctx);
    const topic = db.data.topics.find((candidate) => candidate.id === params.topicId);
    // An inactive topic does not exist for an employee.
    return topic && canSeeTopic(user, topic)
      ? ok(topic)
      : notFound(`Topic ${params.topicId} was not found.`);
  }),
];
