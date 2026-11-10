import type { AssignmentStatus } from '../../app/core/api/api-schema.gen';
import { DERIVED_FIELDS } from '../db/mock-data';
import { toAssignment } from '../rules/training-rules';
import { TEST_NOW } from '../testing';
import { buildSeed } from './seed';

describe('seed data', () => {
  const data = buildSeed(TEST_NOW);

  it('is the same every time for the same date', () => {
    expect(buildSeed(TEST_NOW)).toEqual(data);
  });

  it('has one organization that owns every record', () => {
    // Sessions belong to a user, not to the organization, and the seed starts with none.
    const { organization, sessions, ...tables } = data;
    expect(sessions).toEqual([]);
    for (const [table, rows] of Object.entries(tables)) {
      const foreign = rows.filter(
        (row: { organizationId: string }) => row.organizationId !== organization.id,
      );
      expect(foreign, table).toEqual([]);
    }
  });

  it('has 30 to 50 users with unique emails, the 7 FRD topics and one inactive topic', () => {
    expect(data.users.length).toBeGreaterThanOrEqual(30);
    expect(data.users.length).toBeLessThanOrEqual(50);
    expect(new Set(data.users.map((user) => user.email)).size).toBe(data.users.length);
    expect(data.topics.map((topic) => topic.name)).toEqual([
      'Phishing Awareness',
      'Password Security',
      'Data Protection',
      'Social Engineering',
      'Safe Internet Usage',
      'Device Security',
      'Remote Work Security',
      'Clean Desk Policy',
    ]);
    expect(data.topics.filter((topic) => topic.status === 'inactive').map((t) => t.name)).toEqual([
      'Clean Desk Policy',
    ]);
  });

  it('has assignments in every status', () => {
    const counts = new Map<AssignmentStatus, number>();
    for (const record of data.assignments) {
      const { status } = toAssignment(record, data.attempts, TEST_NOW);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    for (const status of ['not_started', 'in_progress', 'passed', 'failed', 'overdue'] as const) {
      expect(counts.get(status) ?? 0, status).toBeGreaterThan(0);
    }
  });

  it('links each attempt to a version of its own questionnaire', () => {
    for (const attempt of data.attempts) {
      const assignment = data.assignments.find((a) => a.id === attempt.assignmentId);
      const version = data.questionnaireVersions.find(
        (v) => v.id === attempt.questionnaireVersionId,
      );
      expect(version?.questionnaireId).toBe(assignment?.questionnaireId);
    }
  });

  it('uses both versions of an edited questionnaire', () => {
    const edited = data.questionnaires.find((q) =>
      data.questionnaireVersions.some((v) => v.questionnaireId === q.id && v.versionNumber === 2),
    );
    const versionIds = new Set(
      data.questionnaireVersions.filter((v) => v.questionnaireId === edited?.id).map((v) => v.id),
    );
    const usedVersions = new Set(
      data.attempts
        .map((a) => a.questionnaireVersionId)
        .filter((versionId) => versionIds.has(versionId)),
    );

    expect(usedVersions.size).toBe(2);
  });

  it('scores submitted attempts from their answers', () => {
    for (const attempt of data.attempts.filter((a) => a.status === 'submitted')) {
      const answers = data.attemptAnswers.filter((a) => a.attemptId === attempt.id);
      const correct = answers.filter((a) => a.isCorrect).length;

      expect(answers).toHaveLength(attempt.questionCount);
      expect(attempt.correctCount).toBe(correct);
      expect(attempt.passed).toBe((attempt.score ?? 0) >= attempt.passingScore);
    }
  });

  it('keeps at most one open attempt per assignment and none after a pass', () => {
    for (const assignment of data.assignments) {
      const attempts = data.attempts
        .filter((a) => a.assignmentId === assignment.id)
        .sort((a, b) => a.attemptNumber - b.attemptNumber);
      expect(attempts.filter((a) => a.status === 'in_progress').length).toBeLessThanOrEqual(1);
      const passIndex = attempts.findIndex((a) => a.passed);
      if (passIndex >= 0) expect(passIndex).toBe(attempts.length - 1);
    }
  });

  it('gives every question exactly one correct answer and at least two options', () => {
    for (const question of data.questions) {
      const options = data.answerOptions.filter((o) => o.questionId === question.id);
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.filter((o) => o.isCorrect)).toHaveLength(1);
    }
  });

  it('has no timestamps in the future except deadlines and time limits', () => {
    const limit = TEST_NOW.toISOString();
    for (const attempt of data.attempts) {
      expect(attempt.startedAt <= limit).toBe(true);
      expect((attempt.submittedAt ?? '') <= limit).toBe(true);
    }
    for (const user of data.users) {
      expect(user.createdAt <= limit).toBe(true);
    }
  });

  it('logs audit entries the way the audit rules describe', () => {
    const admins = new Set(data.users.filter((u) => u.role === 'administrator').map((u) => u.id));
    const bookkeeping = ['id', 'organizationId', 'createdAt', 'updatedAt'];
    for (const entry of data.auditLog) {
      expect(admins.has(entry.actorId)).toBe(true);
      const fields = entry.changes.map((change) => change.field);
      expect(fields.filter((field) => bookkeeping.includes(field))).toEqual([]);
      const derived: readonly string[] = DERIVED_FIELDS[entry.entityType];
      expect(fields.filter((field) => derived.includes(field))).toEqual([]);
      if (entry.action === 'updated') expect(fields).not.toContain('status');
      if (entry.action === 'created' || entry.action === 'updated') {
        expect(entry.changes.length).toBeGreaterThan(0);
      } else {
        expect(entry.changes).toEqual([]);
      }
      if (entry.entityType === 'assignment') expect(entry.action).toBe('created');
    }
  });

  it('has one inactive draft questionnaire with an empty version 1 and no assignments', () => {
    const drafts = data.questionnaires.filter(
      (q) =>
        !data.questions.some((question) => question.questionnaireVersionId === q.currentVersionId),
    );

    expect(drafts.map((q) => [q.title, q.status])).toEqual([
      ['Reporting suspicious messages', 'inactive'],
    ]);
    const [draft] = drafts;
    expect(data.questionnaireVersions.filter((v) => v.questionnaireId === draft.id)).toEqual([
      expect.objectContaining({ id: draft.currentVersionId, versionNumber: 1 }),
    ]);
    expect(data.assignments.filter((a) => a.questionnaireId === draft.id)).toEqual([]);
    expect(data.auditLog.filter((e) => e.entityId === draft.id).map((e) => e.action)).toEqual([
      'created',
    ]);
  });
});
