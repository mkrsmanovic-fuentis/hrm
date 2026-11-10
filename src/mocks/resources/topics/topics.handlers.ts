import type { Topic } from '../../../app/core/api/api-schema.gen';
import { recordAudit } from '../../db/audit';
import type { TopicRecord } from '../../db/mock-data';
import type { MockDb } from '../../db/mock-db';
import { canSeeTopic } from '../../rules/access-rules';
import {
  isSameTopicName,
  TOPIC_DESCRIPTION_MAX_LENGTH,
  TOPIC_ICONS,
  TOPIC_NAME_MAX_LENGTH,
  toTopic,
} from '../../rules/topic-rules';
import { requireRole, signedInUser } from '../../support/access';
import { BodyReader, notUnique } from '../../support/body';
import { route } from '../../support/mock-route';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const SORTS = [
  'name',
  '-name',
  'questionnaireCount',
  '-questionnaireCount',
  'createdAt',
  '-createdAt',
] as const;

const sortFields = {
  name: (topic: Topic) => topic.name,
  questionnaireCount: (topic: Topic) => topic.questionnaireCount,
  createdAt: (topic: Topic) => Date.parse(topic.createdAt),
};

/**
 * Mock handlers for the Topics tag in the spec. Both roles can read topics; employees only see
 * active ones (see the access rules in docs/developer-guide/business-rules.mdx). Creating and
 * changing topics is for administrators only, and follows the Departments write handlers.
 */
export const topicRoutes = [
  route.get('/topics', (ctx) => {
    const { db, query, page, ok, validationFailed } = ctx;
    const user = signedInUser(ctx);
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const search = query.text('q', { maxLength: TOPIC_NAME_MAX_LENGTH })?.toLowerCase();
    const sort = query.oneOf('sort', SORTS, 'name');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const topics = db.data.topics
      .filter((topic) => canSeeTopic(user, topic) && (!status || topic.status === status))
      .filter((topic) => !search || topic.name.toLowerCase().includes(search))
      .map((topic) => toTopic(topic, db.data.questionnaires));
    return ok(page(sortBy(topics, sort, sortFields), pagination));
  }),

  route.post('/topics', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, now, ok, validationFailed } = ctx;
    const body = new BodyReader(await ctx.json(), ['name', 'description', 'icon']);
    const name = body.text('name', { required: true, maxLength: TOPIC_NAME_MAX_LENGTH });
    const description = body.text('description', {
      required: true,
      maxLength: TOPIC_DESCRIPTION_MAX_LENGTH,
    });
    const icon = body.nullableOneOf('icon', TOPIC_ICONS);
    if (body.errors.length > 0 || name === undefined || description === undefined) {
      return validationFailed(body.errors);
    }
    requireUniqueName(db, name);

    const created = db.update((data) => {
      const at = now.toISOString();
      const topic: TopicRecord = {
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        name,
        description,
        icon: icon ?? null,
        status: 'active',
        createdAt: at,
        updatedAt: at,
      };
      data.topics.push(topic);
      recordAudit(data, {
        action: 'created',
        entityType: 'topic',
        actorId: admin.id,
        now,
        after: topic,
      });
      return topic;
    });
    return ok(toTopic(created, db.data.questionnaires), 201);
  }),

  route.get('/topics/{topicId}', (ctx) => {
    const { db, params, ok, notFound } = ctx;
    const user = signedInUser(ctx);
    const topic = db.data.topics.find((candidate) => candidate.id === params.topicId);
    // An inactive topic does not exist for an employee.
    return topic && canSeeTopic(user, topic)
      ? ok(toTopic(topic, db.data.questionnaires))
      : notFound(`Topic ${params.topicId} was not found.`);
  }),

  route.patch('/topics/{topicId}', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound, validationFailed } = ctx;
    const topic = db.data.topics.find((candidate) => candidate.id === params.topicId);
    if (!topic) return notFound(`Topic ${params.topicId} was not found.`);

    const body = new BodyReader(await ctx.json(), ['name', 'description', 'icon', 'status']);
    const name = body.text('name', { maxLength: TOPIC_NAME_MAX_LENGTH });
    const description = body.text('description', { maxLength: TOPIC_DESCRIPTION_MAX_LENGTH });
    const icon = body.nullableOneOf('icon', TOPIC_ICONS);
    const status = body.oneOf('status', STATUSES);
    if (body.errors.length > 0) return validationFailed(body.errors);
    if (name !== undefined) requireUniqueName(db, name, topic.id);

    const changes: Partial<TopicRecord> = {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(icon !== undefined && { icon }),
      ...(status !== undefined && { status }),
    };
    const updated = db.update((data) => {
      const before = structuredClone(topic);
      Object.assign(topic, changes);
      // Logs `updated` for name, description and icon, and `deactivated` or `reactivated` for status.
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'topic',
        actorId: admin.id,
        now,
        before,
        after: topic,
      });
      if (entries.length > 0) topic.updatedAt = now.toISOString();
      return topic;
    });
    return ok(toTopic(updated, db.data.questionnaires));
  }),
];

/** Answers `409` when another topic already has the name. */
function requireUniqueName(db: MockDb, name: string, exceptId?: string): void {
  const taken = db.data.topics.some(
    (other) => other.id !== exceptId && isSameTopicName(other.name, name),
  );
  if (taken) {
    throw notUnique(
      'name',
      'A topic with this name already exists.',
      `A topic named ${name} already exists.`,
    );
  }
}
