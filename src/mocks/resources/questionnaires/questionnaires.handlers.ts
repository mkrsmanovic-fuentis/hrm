import type { FieldError, Questionnaire } from '../../../app/core/api/api-schema.gen';
import { recordAudit } from '../../db/audit';
import type { QuestionnaireRecord, QuestionnaireVersionRecord } from '../../db/mock-data';
import type { MockDb } from '../../db/mock-db';
import {
  activationProblems,
  PASSING_SCORE_MAX,
  PASSING_SCORE_MIN,
  QUESTIONNAIRE_DESCRIPTION_MAX_LENGTH,
  QUESTIONNAIRE_TITLE_MAX_LENGTH,
  TIME_LIMIT_MAX,
  TIME_LIMIT_MIN,
  toQuestionnaire,
} from '../../rules/questionnaire-rules';
import { DEFAULT_PASSING_SCORE } from '../../rules/training-rules';
import { requireRole } from '../../support/access';
import { BodyReader } from '../../support/body';
import { route } from '../../support/mock-route';
import { MockProblem } from '../../support/problem';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const SORTS = [
  'title',
  '-title',
  'questionCount',
  '-questionCount',
  'passingScore',
  '-passingScore',
  'createdAt',
  '-createdAt',
] as const;
/** Longest value accepted for an ID in the query; a UUID has 36 characters. */
const ID_MAX_LENGTH = 100;

const sortFields = {
  title: (q: Questionnaire) => q.title,
  questionCount: (q: Questionnaire) => q.questionCount,
  passingScore: (q: Questionnaire) => q.passingScore,
  createdAt: (q: Questionnaire) => Date.parse(q.createdAt),
};

/** Fields an administrator may send when creating or changing a questionnaire's settings. */
const SETTINGS_FIELDS = [
  'title',
  'description',
  'topicId',
  'passingScore',
  'timeLimitMinutes',
] as const;

/**
 * Mock handlers for the Questionnaires tag in the spec: the questionnaire record and its
 * settings. Every endpoint is for administrators only; employees reach questionnaires through
 * their own assignments. Follows the Departments write handlers. Questions and versions are
 * edited elsewhere (SPE-18).
 */
export const questionnaireRoutes = [
  route.get('/questionnaires', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, query, page, ok, validationFailed } = ctx;
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const topicId = query.text('topicId', { maxLength: ID_MAX_LENGTH });
    const search = query.text('q', { maxLength: QUESTIONNAIRE_TITLE_MAX_LENGTH })?.toLowerCase();
    const sort = query.oneOf('sort', SORTS, 'title');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const questionnaires = db.data.questionnaires
      .filter((q) => (!status || q.status === status) && (!topicId || q.topicId === topicId))
      .filter((q) => !search || q.title.toLowerCase().includes(search))
      .map((q) => toQuestionnaire(q, db.data));
    return ok(page(sortBy(questionnaires, sort, sortFields), pagination));
  }),

  route.post('/questionnaires', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, now, ok, validationFailed } = ctx;
    const body = new BodyReader(await ctx.json(), SETTINGS_FIELDS);
    const title = body.text('title', { required: true, maxLength: QUESTIONNAIRE_TITLE_MAX_LENGTH });
    const description = body.nullableText('description', {
      maxLength: QUESTIONNAIRE_DESCRIPTION_MAX_LENGTH,
    });
    const topicId = body.text('topicId', { required: true, maxLength: ID_MAX_LENGTH });
    const passingScore = body.integer('passingScore', {
      min: PASSING_SCORE_MIN,
      max: PASSING_SCORE_MAX,
    });
    const timeLimitMinutes = body.nullableInteger('timeLimitMinutes', {
      min: TIME_LIMIT_MIN,
      max: TIME_LIMIT_MAX,
    });
    const errors = [...body.errors, ...topicErrors(db, topicId)];
    if (errors.length > 0 || title === undefined || topicId === undefined) {
      return validationFailed(errors);
    }

    const created = db.update((data) => {
      const at = now.toISOString();
      const id = crypto.randomUUID();
      // A new questionnaire starts with an empty version 1. Questions are added to it later.
      const version: QuestionnaireVersionRecord = {
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        questionnaireId: id,
        versionNumber: 1,
        createdAt: at,
        updatedAt: at,
      };
      const questionnaire: QuestionnaireRecord = {
        id,
        organizationId: data.organization.id,
        topicId,
        title,
        description: description ?? null,
        passingScore: passingScore ?? DEFAULT_PASSING_SCORE,
        timeLimitMinutes: timeLimitMinutes ?? null,
        // Draft first: it cannot be activated until it has questions.
        status: 'inactive',
        currentVersionId: version.id,
        createdAt: at,
        updatedAt: at,
      };
      data.questionnaireVersions.push(version);
      data.questionnaires.push(questionnaire);
      recordAudit(data, {
        action: 'created',
        entityType: 'questionnaire',
        actorId: admin.id,
        now,
        after: questionnaire,
      });
      return questionnaire;
    });
    return ok(toQuestionnaire(created, db.data), 201);
  }),

  route.get('/questionnaires/{questionnaireId}', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, params, ok, notFound } = ctx;
    const questionnaire = db.data.questionnaires.find((q) => q.id === params.questionnaireId);
    return questionnaire
      ? ok(toQuestionnaire(questionnaire, db.data))
      : notFound(`Questionnaire ${params.questionnaireId} was not found.`);
  }),

  route.patch('/questionnaires/{questionnaireId}', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound, validationFailed } = ctx;
    const questionnaire = db.data.questionnaires.find((q) => q.id === params.questionnaireId);
    if (!questionnaire) return notFound(`Questionnaire ${params.questionnaireId} was not found.`);

    const body = new BodyReader(await ctx.json(), [...SETTINGS_FIELDS, 'status']);
    const title = body.text('title', { maxLength: QUESTIONNAIRE_TITLE_MAX_LENGTH });
    const description = body.nullableText('description', {
      maxLength: QUESTIONNAIRE_DESCRIPTION_MAX_LENGTH,
    });
    const topicId = body.text('topicId', { maxLength: ID_MAX_LENGTH });
    const passingScore = body.integer('passingScore', {
      min: PASSING_SCORE_MIN,
      max: PASSING_SCORE_MAX,
    });
    const timeLimitMinutes = body.nullableInteger('timeLimitMinutes', {
      min: TIME_LIMIT_MIN,
      max: TIME_LIMIT_MAX,
    });
    const status = body.oneOf('status', STATUSES);
    // Staying in the current topic is not a move, even when that topic is inactive.
    const moved = topicId !== undefined && topicId !== questionnaire.topicId ? topicId : undefined;
    const errors = [...body.errors, ...topicErrors(db, moved)];
    if (errors.length > 0) return validationFailed(errors);

    if (status === 'active' && questionnaire.status !== 'active') {
      const problems = activationProblems(questionnaire, db.data);
      if (problems.length > 0) throw new MockProblem(409, problems.join(' '));
    }

    // Settings never create a new version: `currentVersionId` stays as it is.
    const changes: Partial<QuestionnaireRecord> = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(moved !== undefined && { topicId: moved }),
      ...(passingScore !== undefined && { passingScore }),
      ...(timeLimitMinutes !== undefined && { timeLimitMinutes }),
      ...(status !== undefined && { status }),
    };
    const updated = db.update((data) => {
      const before = structuredClone(questionnaire);
      Object.assign(questionnaire, changes);
      // Logs `updated` for the settings, and `deactivated` or `reactivated` for status.
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'questionnaire',
        actorId: admin.id,
        now,
        before,
        after: questionnaire,
      });
      if (entries.length > 0) questionnaire.updatedAt = now.toISOString();
      return questionnaire;
    });
    return ok(toQuestionnaire(updated, db.data));
  }),
];

/**
 * A topic chosen for a new questionnaire, or one it moves to, must exist and be active.
 * Returns the problems with `topicId`, or none when it was not sent.
 */
function topicErrors(db: MockDb, topicId: string | undefined): FieldError[] {
  if (topicId === undefined) return [];
  const topic = db.data.topics.find((candidate) => candidate.id === topicId);
  const fail = (message: string): FieldError[] => [
    { location: 'body', field: 'topicId', code: 'invalid_value', message },
  ];
  if (!topic) return fail('Choose an existing topic.');
  if (topic.status !== 'active') return fail('This topic is inactive. Choose an active topic.');
  return [];
}
