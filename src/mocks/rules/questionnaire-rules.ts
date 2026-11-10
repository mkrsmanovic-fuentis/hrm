/*
 * Questionnaire rules the mock applies, mirrored from the "Questionnaires" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type {
  FieldError,
  Question,
  Questionnaire,
  QuestionnaireVersion,
} from '../../app/core/api/api-schema.gen';
import type { MockData, QuestionnaireRecord, QuestionnaireVersionRecord } from '../db/mock-data';

export const QUESTIONNAIRE_TITLE_MAX_LENGTH = 200;
export const QUESTIONNAIRE_DESCRIPTION_MAX_LENGTH = 2000;
/** `PassingScore` in the spec: a whole number from 1 to 100. */
export const PASSING_SCORE_MIN = 1;
export const PASSING_SCORE_MAX = 100;
/** `TimeLimitMinutes` in the spec: 1 minute to 8 hours, the length of a session. */
export const TIME_LIMIT_MIN = 1;
export const TIME_LIMIT_MAX = 480;
/** `QuestionInput.text` in the spec. */
export const QUESTION_TEXT_MAX_LENGTH = 1000;
/** `QuestionInput.explanation` in the spec. */
export const QUESTION_EXPLANATION_MAX_LENGTH = 2000;
/** `AnswerOptionInput.text` in the spec. */
export const ANSWER_OPTION_TEXT_MAX_LENGTH = 500;
/** A complete question has at least this many answer options. */
export const MIN_ANSWER_OPTIONS = 2;

/** `questionCount`: the questions in the questionnaire's current version. */
export function questionCount(
  record: Pick<QuestionnaireRecord, 'currentVersionId'>,
  data: Pick<MockData, 'questions'>,
): number {
  return data.questions.filter(
    (question) => question.questionnaireVersionId === record.currentVersionId,
  ).length;
}

/** The API's `Questionnaire`: the stored record plus its derived `questionCount`. */
export function toQuestionnaire(
  record: QuestionnaireRecord,
  data: Pick<MockData, 'questions'>,
): Questionnaire {
  return { ...record, questionCount: questionCount(record, data) };
}

/**
 * Why the questionnaire cannot be activated yet, as sentences for the `409` problem's `detail`.
 * Empty when it can be activated.
 *
 * For now the only check is that the current version has at least one question. The full checks
 * before activation (SPE-19) are added here.
 */
export function activationProblems(
  record: QuestionnaireRecord,
  data: Pick<MockData, 'questions'>,
): string[] {
  const problems: string[] = [];
  if (questionCount(record, data) === 0) {
    problems.push('Add at least one question before activating this questionnaire.');
  }
  return problems;
}

/** The parts of a question that decide whether it is complete. */
export interface QuestionShape {
  answerOptions: readonly { isCorrect: boolean }[];
}

/**
 * Why a list of questions is not complete, as field errors with the API's field names:
 *
 * - `questions` (`too_short`): there are no questions.
 * - `questions[i].answerOptions` (`too_short`): a question has fewer than two answer options.
 * - `questions[i].answerOptions` (`invalid_value`): a question does not have exactly one correct
 *   answer.
 *
 * Empty when the questions are complete. An active questionnaire must always be complete, so
 * saving questions that are not answers `422` with these errors; an inactive draft may be saved
 * incomplete. The checks before activation (SPE-19) are meant to reuse this through
 * `activationProblems()`. Text is checked by the request body reader, not here.
 */
export function questionSetProblems(questions: readonly QuestionShape[]): FieldError[] {
  const problems: FieldError[] = [];
  const fail = (field: string, code: string, message: string) =>
    problems.push({ location: 'body', field, code, message });
  if (questions.length === 0) fail('questions', 'too_short', 'Add at least one question.');
  questions.forEach((question, index) => {
    const field = `questions[${index}].answerOptions`;
    if (question.answerOptions.length < MIN_ANSWER_OPTIONS) {
      fail(field, 'too_short', `Add at least ${MIN_ANSWER_OPTIONS} answer options.`);
    }
    const correct = question.answerOptions.filter((option) => option.isCorrect).length;
    if (correct !== 1) {
      fail(
        field,
        'invalid_value',
        correct === 0 ? 'Choose the correct answer.' : 'Only one answer can be correct.',
      );
    }
  });
  return problems;
}

/** The questions of a version, with their answer options nested, both in display order. */
export function questionsOfVersion(
  versionId: string,
  data: Pick<MockData, 'questions' | 'answerOptions'>,
): Question[] {
  return data.questions
    .filter((question) => question.questionnaireVersionId === versionId)
    .sort((a, b) => a.position - b.position)
    .map((question) => ({
      ...question,
      answerOptions: data.answerOptions
        .filter((option) => option.questionId === question.id)
        .sort((a, b) => a.position - b.position),
    }));
}

/** `attemptCount` of a version: its attempts, in progress and submitted. */
export function versionAttemptCount(versionId: string, data: Pick<MockData, 'attempts'>): number {
  return data.attempts.filter((attempt) => attempt.questionnaireVersionId === versionId).length;
}

/** The API's `QuestionnaireVersion`: the stored version with its questions and `attemptCount`. */
export function toQuestionnaireVersion(
  version: QuestionnaireVersionRecord,
  data: Pick<MockData, 'questions' | 'answerOptions' | 'attempts'>,
): QuestionnaireVersion {
  return {
    ...version,
    questions: questionsOfVersion(version.id, data),
    attemptCount: versionAttemptCount(version.id, data),
  };
}
