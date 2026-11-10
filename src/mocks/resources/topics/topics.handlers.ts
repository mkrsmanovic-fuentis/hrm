import type { Topic } from '../../../app/core/api/api-schema.gen';
import { route } from '../../support/mock-route';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const SORTS = ['name', '-name', 'createdAt', '-createdAt'] as const;

const sortFields = {
  name: (topic: Topic) => topic.name,
  createdAt: (topic: Topic) => Date.parse(topic.createdAt),
};

/** Mock handlers for the Topics tag in the spec. */
export const topicRoutes = [
  route.get('/topics', ({ db, query, page, ok, validationFailed }) => {
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const sort = query.oneOf('sort', SORTS, 'name');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const topics = db.data.topics.filter((topic) => !status || topic.status === status);
    return ok(page(sortBy(topics, sort, sortFields), pagination));
  }),

  route.get('/topics/{topicId}', ({ db, params, ok, notFound }) => {
    const topic = db.data.topics.find((candidate) => candidate.id === params.topicId);
    return topic ? ok(topic) : notFound(`Topic ${params.topicId} was not found.`);
  }),
];
