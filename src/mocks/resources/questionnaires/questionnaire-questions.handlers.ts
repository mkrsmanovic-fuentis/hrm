import type {
  AnswerOption,
  AnswerOptionInput,
  FieldError,
  QuestionInput,
} from '../../../app/core/api/api-schema.gen';
import { recordAudit, sameValue } from '../../db/audit';
import type { MockData, QuestionnaireVersionRecord, QuestionRecord } from '../../db/mock-data';
import {
  ANSWER_OPTION_TEXT_MAX_LENGTH,
  QUESTION_EXPLANATION_MAX_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  questionSetProblems,
  questionsOfVersion,
  toQuestionnaireVersion,
  versionAttemptCount,
} from '../../rules/questionnaire-rules';
import { requireRole } from '../../support/access';
import { BodyReader, isObject } from '../../support/body';
import { route } from '../../support/mock-route';

/** A question as it is saved, compared and logged: the `QuestionInput` shape, explanation set. */
interface QuestionContent {
  text: string;
  explanation: string | null;
  answerOptions: AnswerOptionInput[];
}

/**
 * Mock handlers for a questionnaire's questions: read the current version, and save the whole
 * ordered list at once. Administrators only; employees never get correct answers from here.
 *
 * Saving replaces the current version's questions in place while no attempt uses that version,
 * and creates a new version once one does. See "Questionnaire versions" in
 * docs/developer-guide/business-rules.mdx.
 */
export const questionnaireQuestionRoutes = [
  route.get('/questionnaires/{questionnaireId}/questions', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, params, ok, notFound } = ctx;
    const questionnaire = db.data.questionnaires.find((q) => q.id === params.questionnaireId);
    const version = db.data.questionnaireVersions.find(
      (v) => v.id === questionnaire?.currentVersionId,
    );
    if (!questionnaire || !version) {
      return notFound(`Questionnaire ${params.questionnaireId} was not found.`);
    }
    return ok(toQuestionnaireVersion(version, db.data));
  }),

  route.put('/questionnaires/{questionnaireId}/questions', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound, validationFailed } = ctx;
    const questionnaire = db.data.questionnaires.find((q) => q.id === params.questionnaireId);
    const current = db.data.questionnaireVersions.find(
      (v) => v.id === questionnaire?.currentVersionId,
    );
    if (!questionnaire || !current) {
      return notFound(`Questionnaire ${params.questionnaireId} was not found.`);
    }

    const { questions, errors } = readQuestions(await ctx.json());
    // An active questionnaire must stay valid; an inactive draft may be saved incomplete.
    if (errors.length === 0 && questionnaire.status === 'active') {
      errors.push(...questionSetProblems(questions));
    }
    if (errors.length > 0) return validationFailed(errors);

    const before = contentOf(questionsOfVersion(current.id, db.data));
    // Nothing changed: no new version, no log entry, nothing saved.
    if (sameValue(before, questions)) return ok(toQuestionnaireVersion(current, db.data));

    const saved = db.update((data) => {
      const at = now.toISOString();
      const previous = structuredClone(questionnaire);
      let version = current;
      if (versionAttemptCount(current.id, data) > 0) {
        // Attempts use the current version: it stays as it is, and the edit becomes a new one.
        version = {
          id: crypto.randomUUID(),
          organizationId: data.organization.id,
          questionnaireId: questionnaire.id,
          versionNumber: latestVersionNumber(data, questionnaire.id) + 1,
          createdAt: at,
          updatedAt: at,
        };
        data.questionnaireVersions.push(version);
        questionnaire.currentVersionId = version.id;
      } else {
        // No attempts yet: replace the questions of the current version in place.
        removeQuestions(data, current.id);
        current.updatedAt = at;
      }
      addQuestions(data, version, questions, at);
      questionnaire.updatedAt = at;
      // `questions` is not a field of the questionnaire record, so it is added to both sides for
      // the log: the content before and after, in the `QuestionInput` shape. `currentVersionId`
      // is listed too when a new version was created.
      const logBefore = { ...previous, questions: before };
      const logAfter = { ...questionnaire, questions };
      recordAudit(data, {
        action: 'updated',
        entityType: 'questionnaire',
        actorId: admin.id,
        now,
        before: logBefore,
        after: logAfter,
      });
      return version;
    });
    return ok(toQuestionnaireVersion(saved, db.data));
  }),
];

/**
 * Reads `QuestionnaireQuestionsUpdate`: every question and answer option, trimmed, with every
 * invalid field in `errors`. Completeness (enough options, one correct answer) is checked
 * separately, by `questionSetProblems()`.
 */
function readQuestions(raw: unknown): { questions: QuestionContent[]; errors: FieldError[] } {
  const body = new BodyReader(raw, ['questions']);
  const items = body.array('questions', { required: true }) ?? [];
  const errors: FieldError[] = body.errors;
  const questions = items.map((item, index): QuestionContent => {
    const prefix = `questions[${index}].`;
    const empty: QuestionContent = { text: '', explanation: null, answerOptions: [] };
    if (!isObject(item)) {
      errors.push(objectExpected(`questions[${index}]`));
      return empty;
    }
    const question = new BodyReader(item, ['text', 'explanation', 'answerOptions'], prefix);
    const text = question.text('text', { required: true, maxLength: QUESTION_TEXT_MAX_LENGTH });
    const explanation = question.nullableText('explanation', {
      maxLength: QUESTION_EXPLANATION_MAX_LENGTH,
    });
    const options = question.array('answerOptions', { required: true }) ?? [];
    const answerOptions = options.map((optionItem, optionIndex): AnswerOptionInput => {
      const optionField = `${prefix}answerOptions[${optionIndex}]`;
      if (!isObject(optionItem)) {
        errors.push(objectExpected(optionField));
        return { text: '', isCorrect: false };
      }
      const option = new BodyReader(optionItem, ['text', 'isCorrect'], `${optionField}.`);
      const optionText = option.text('text', {
        required: true,
        maxLength: ANSWER_OPTION_TEXT_MAX_LENGTH,
      });
      const isCorrect = option.boolean('isCorrect', { required: true });
      errors.push(...option.errors);
      return { text: optionText ?? '', isCorrect: isCorrect ?? false };
    });
    errors.push(...question.errors);
    return { text: text ?? '', explanation: explanation ?? null, answerOptions };
  });
  return { questions, errors };
}

function objectExpected(field: string): FieldError {
  return { location: 'body', field, code: 'invalid_type', message: 'Must be an object.' };
}

/** The content of stored questions, in the shape a save sends, for comparing and logging. */
function contentOf(questions: ReturnType<typeof questionsOfVersion>): QuestionContent[] {
  return questions.map((question) => ({
    text: question.text,
    explanation: question.explanation,
    answerOptions: question.answerOptions.map((option) => ({
      text: option.text,
      isCorrect: option.isCorrect,
    })),
  }));
}

function latestVersionNumber(data: MockData, questionnaireId: string): number {
  return Math.max(
    0,
    ...data.questionnaireVersions
      .filter((version) => version.questionnaireId === questionnaireId)
      .map((version) => version.versionNumber),
  );
}

/** Removes a version's questions and their answer options. Only for a version without attempts. */
function removeQuestions(data: MockData, versionId: string): void {
  const removed = new Set(
    data.questions.filter((q) => q.questionnaireVersionId === versionId).map((q) => q.id),
  );
  data.questions = data.questions.filter((question) => !removed.has(question.id));
  data.answerOptions = data.answerOptions.filter((option) => !removed.has(option.questionId));
}

/** Adds questions to a version, with positions from their order. */
function addQuestions(
  data: MockData,
  version: QuestionnaireVersionRecord,
  questions: readonly QuestionInput[],
  at: string,
): void {
  questions.forEach((input, index) => {
    const question: QuestionRecord = {
      id: crypto.randomUUID(),
      organizationId: data.organization.id,
      questionnaireVersionId: version.id,
      position: index + 1,
      text: input.text,
      explanation: input.explanation ?? null,
      createdAt: at,
      updatedAt: at,
    };
    data.questions.push(question);
    input.answerOptions.forEach((optionInput, optionIndex) => {
      const option: AnswerOption = {
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        questionId: question.id,
        position: optionIndex + 1,
        text: optionInput.text,
        isCorrect: optionInput.isCorrect,
        createdAt: at,
        updatedAt: at,
      };
      data.answerOptions.push(option);
    });
  });
}
