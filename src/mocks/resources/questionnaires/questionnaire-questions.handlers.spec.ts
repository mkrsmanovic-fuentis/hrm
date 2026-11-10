import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import type { QuestionInput } from '../../../app/core/api/api-schema.gen';
import { questionsOfVersion } from '../../rules/questionnaire-rules';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('questionnaire questions mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    return { api: TestBed.inject(ApiClient), mock };
  }

  type Mock = ReturnType<typeof setup>['mock'];

  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('Expected the request to fail');
  }

  const questionnaire = (mock: Mock, title: string) => {
    const found = mock.db.data.questionnaires.find((q) => q.title === title);
    if (!found) throw new Error(`No seeded questionnaire ${title}`);
    return found;
  };

  /** Creates a draft and returns it; it has an empty version 1 and no attempts. */
  async function createDraft(api: ApiClient, mock: Mock) {
    const topicId = mock.db.data.topics.find((t) => t.status === 'active')?.id ?? '';
    return firstValueFrom(
      api.post('/questionnaires', { body: { title: 'Draft for questions', topicId } }),
    );
  }

  const question = (text: string, correct = 0, options = ['Yes', 'No']): QuestionInput => ({
    text,
    explanation: null,
    answerOptions: options.map((option, index) => ({ text: option, isCorrect: index === correct })),
  });

  const save = (api: ApiClient, questionnaireId: string, questions: unknown[]) =>
    firstValueFrom(
      api.put('/questionnaires/{questionnaireId}/questions', {
        path: { questionnaireId },
        body: { questions: questions as QuestionInput[] },
      }),
    );

  const json = { 'Content-Type': 'application/json' };
  const WITH_ATTEMPTS = 'Spotting phishing emails';

  describe('get', () => {
    it('returns the current version with its questions and options in order, and its attempt count', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, WITH_ATTEMPTS);

      const version = await firstValueFrom(
        api.get('/questionnaires/{questionnaireId}/questions', {
          path: { questionnaireId: record.id },
        }),
      );

      expect(version).toMatchObject({ id: record.currentVersionId, versionNumber: 2 });
      expect(version.attemptCount).toBe(
        mock.db.data.attempts.filter((a) => a.questionnaireVersionId === record.currentVersionId)
          .length,
      );
      expect(version.attemptCount).toBeGreaterThan(0);
      expect(version.questions.length).toBeGreaterThan(0);
      expect(version.questions.map((q) => q.position)).toEqual(
        version.questions.map((_, index) => index + 1),
      );
      for (const q of version.questions) {
        expect(q.answerOptions.map((o) => o.position)).toEqual(
          q.answerOptions.map((_, index) => index + 1),
        );
        expect(q.answerOptions.filter((o) => o.isCorrect)).toHaveLength(1);
      }
    });

    it('returns an empty version 1 for a new draft, and 404 for an unknown questionnaire', async () => {
      const { api, mock } = setup();
      const draft = await createDraft(api, mock);

      const version = await firstValueFrom(
        api.get('/questionnaires/{questionnaireId}/questions', {
          path: { questionnaireId: draft.id },
        }),
      );
      const missing = await failure(
        firstValueFrom(
          api.get('/questionnaires/{questionnaireId}/questions', {
            path: { questionnaireId: crypto.randomUUID() },
          }),
        ),
      );

      expect(version).toMatchObject({ versionNumber: 1, questions: [], attemptCount: 0 });
      expect(missing.isNotFound).toBe(true);
    });
  });

  describe('save', () => {
    it('replaces the questions in place when no attempt uses the version, in the order sent', async () => {
      const { api, mock } = setup();
      const draft = await createDraft(api, mock);
      await save(api, draft.id, [question('First'), question('Second')]);
      const logSize = mock.db.data.auditLog.length;
      const versionCount = mock.db.data.questionnaireVersions.length;

      const version = await save(api, draft.id, [
        { ...question('Second', 1, ['A', 'B', 'C']), explanation: '  Look closer.  ' },
        question(' First '),
      ]);

      expect(version).toMatchObject({ id: draft.currentVersionId, versionNumber: 1 });
      expect(mock.db.data.questionnaireVersions).toHaveLength(versionCount);
      expect(version.questions.map((q) => [q.position, q.text, q.explanation])).toEqual([
        [1, 'Second', 'Look closer.'],
        [2, 'First', null],
      ]);
      expect(version.questions[0].answerOptions.map((o) => [o.position, o.isCorrect])).toEqual([
        [1, false],
        [2, true],
        [3, false],
      ]);
      // The old questions are gone: only the saved ones belong to the version.
      expect(questionsOfVersion(draft.currentVersionId, mock.db.data)).toHaveLength(2);
      expect(questionnaire(mock, 'Draft for questions').updatedAt).toBe(TEST_NOW.toISOString());

      const entries = mock.db.data.auditLog.slice(logSize);
      expect(entries).toEqual([
        expect.objectContaining({
          action: 'updated',
          entityType: 'questionnaire',
          entityId: draft.id,
          changes: [
            {
              field: 'questions',
              oldValue: [
                { text: 'First', explanation: null, answerOptions: question('').answerOptions },
                { text: 'Second', explanation: null, answerOptions: question('').answerOptions },
              ],
              newValue: [
                {
                  text: 'Second',
                  explanation: 'Look closer.',
                  answerOptions: question('', 1, ['A', 'B', 'C']).answerOptions,
                },
                { text: 'First', explanation: null, answerOptions: question('').answerOptions },
              ],
            },
          ],
        }),
      ]);
      expect(entries[0].changes.map((c) => c.field)).not.toContain('questionCount');
    });

    it('creates a new version when attempts use the current one, and leaves earlier versions and attempts unchanged', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, WITH_ATTEMPTS);
      const oldVersionId = record.currentVersionId;
      const oldQuestions = structuredClone(questionsOfVersion(oldVersionId, mock.db.data));
      const oldVersions = structuredClone(mock.db.data.questionnaireVersions);
      const oldAttempts = structuredClone(mock.db.data.attempts);
      const oldAnswers = structuredClone(mock.db.data.attemptAnswers);
      const open = mock.db.data.attempts.filter(
        (a) => a.questionnaireVersionId === oldVersionId && a.status === 'in_progress',
      );
      expect(open.length).toBeGreaterThan(0);
      const logSize = mock.db.data.auditLog.length;

      const edited: QuestionInput[] = oldQuestions.map((q) => ({
        text: q.text,
        explanation: q.explanation,
        answerOptions: q.answerOptions.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
      }));
      edited.reverse();
      edited.push(question('Is a new question added?'));

      const version = await save(api, record.id, edited);

      expect(version.versionNumber).toBe(3);
      expect(version.id).not.toBe(oldVersionId);
      expect(version.attemptCount).toBe(0);
      expect(version.questions.map((q) => q.text)).toEqual(edited.map((q) => q.text));
      expect(record.currentVersionId).toBe(version.id);

      // Earlier versions, their questions, attempts and answers are untouched.
      expect(mock.db.data.questionnaireVersions.filter((v) => v.id !== version.id)).toEqual(
        oldVersions,
      );
      expect(questionsOfVersion(oldVersionId, mock.db.data)).toEqual(oldQuestions);
      expect(mock.db.data.attempts).toEqual(oldAttempts);
      expect(mock.db.data.attemptAnswers).toEqual(oldAnswers);
      // Attempts in progress stay on the version they started with.
      for (const attempt of open) {
        expect(mock.db.data.attempts.find((a) => a.id === attempt.id)?.questionnaireVersionId).toBe(
          oldVersionId,
        );
      }

      const entries = mock.db.data.auditLog.slice(logSize);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ action: 'updated', entityId: record.id });
      expect(entries[0].changes.map((c) => c.field)).toEqual(['currentVersionId', 'questions']);
      expect(entries[0].changes[0]).toEqual({
        field: 'currentVersionId',
        oldValue: oldVersionId,
        newValue: version.id,
      });
    });

    it('does nothing when the questions sent are the same as the current ones', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, WITH_ATTEMPTS);
      const current = questionsOfVersion(record.currentVersionId, mock.db.data);
      const versionCount = mock.db.data.questionnaireVersions.length;
      const logSize = mock.db.data.auditLog.length;
      const updatedAt = record.updatedAt;

      const version = await save(
        api,
        record.id,
        current.map((q) => ({
          text: q.text,
          explanation: q.explanation,
          answerOptions: q.answerOptions.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
        })),
      );

      expect(version.id).toBe(record.currentVersionId);
      expect(mock.db.data.questionnaireVersions).toHaveLength(versionCount);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
      expect(record.updatedAt).toBe(updatedAt);
    });

    it('answers 422 when an active questionnaire would become invalid, and changes nothing', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, WITH_ATTEMPTS);
      const before = structuredClone(mock.db.data);

      const empty = await failure(save(api, record.id, []));
      const incomplete = await failure(
        save(api, record.id, [
          question('One option', 0, ['Only']),
          question('No correct answer', -1),
          {
            text: 'Two correct',
            answerOptions: [
              { text: 'A', isCorrect: true },
              { text: 'B', isCorrect: true },
            ],
          },
        ]),
      );

      expect(empty.isValidation).toBe(true);
      expect(empty.fieldErrors).toEqual([expect.objectContaining({ field: 'questions' })]);
      expect(incomplete.fieldErrors.map((e) => [e.field, e.code])).toEqual([
        ['questions[0].answerOptions', 'too_short'],
        ['questions[1].answerOptions', 'invalid_value'],
        ['questions[2].answerOptions', 'invalid_value'],
      ]);
      expect(mock.db.data).toEqual(before);
    });

    it('lets an inactive draft be saved incomplete', async () => {
      const { api, mock } = setup();
      const draft = await createDraft(api, mock);

      const version = await save(api, draft.id, [
        question('Only one option', 0, ['Only']),
        question('No correct answer yet', -1),
      ]);
      const cleared = await save(api, draft.id, []);

      expect(version.questions).toHaveLength(2);
      expect(cleared.questions).toEqual([]);
    });

    it('answers 422 with every invalid field, whatever the status, and changes nothing', async () => {
      const { api, mock } = setup();
      const draft = await createDraft(api, mock);
      const logSize = mock.db.data.auditLog.length;

      const error = await failure(
        save(api, draft.id, [
          { text: '  ', answerOptions: [{ text: 'x'.repeat(501), isCorrect: 'yes' }] },
          { text: 'x'.repeat(1001), explanation: 'x'.repeat(2001), answerOptions: [], extra: 1 },
          'not a question',
          { text: 'No options' },
        ]),
      );

      expect(error.fieldErrors.map((e) => [e.field, e.code])).toEqual([
        ['questions[0].answerOptions[0].text', 'too_long'],
        ['questions[0].answerOptions[0].isCorrect', 'invalid_type'],
        ['questions[0].text', 'required'],
        ['questions[1].extra', 'invalid_value'],
        ['questions[1].text', 'too_long'],
        ['questions[1].explanation', 'too_long'],
        ['questions[2]', 'invalid_type'],
        ['questions[3].answerOptions', 'required'],
      ]);
      expect(mock.db.data.auditLog).toHaveLength(logSize);

      const missing = await mock.fetch(`/api/v1/questionnaires/${draft.id}/questions`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ extra: true }),
      });
      expect(missing.status).toBe(422);
      expect((await missing.json()).errors.map((e: { field: string }) => e.field)).toEqual([
        'extra',
        'questions',
      ]);
    });

    it('answers 404 for an unknown questionnaire', async () => {
      const { api } = setup();

      const error = await failure(save(api, crypto.randomUUID(), [question('Q')]));

      expect(error.isNotFound).toBe(true);
    });
  });

  describe('access', () => {
    it('answers 403 to employees on both endpoints, before validating, and changes nothing', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      const record = questionnaire(mock, WITH_ATTEMPTS);
      const before = structuredClone(mock.db.data.questions);
      const logSize = mock.db.data.auditLog.length;

      const responses = await Promise.all([
        mock.fetch(`/api/v1/questionnaires/${record.id}/questions`),
        mock.fetch(`/api/v1/questionnaires/${record.id}/questions`, {
          method: 'PUT',
          headers: json,
          body: JSON.stringify({ questions: [] }),
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.type).toBe(ProblemType.forbidden);
        expect(JSON.stringify(body)).not.toContain('isCorrect');
      }
      expect(mock.db.data.questions).toEqual(before);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });
  });
});
