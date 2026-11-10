/*
 * Questionnaire rules the mock applies, mirrored from the "Questionnaires" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { Questionnaire } from '../../app/core/api/api-schema.gen';
import type { MockData, QuestionnaireRecord } from '../db/mock-data';

export const QUESTIONNAIRE_TITLE_MAX_LENGTH = 200;
export const QUESTIONNAIRE_DESCRIPTION_MAX_LENGTH = 2000;
/** `PassingScore` in the spec: a whole number from 1 to 100. */
export const PASSING_SCORE_MIN = 1;
export const PASSING_SCORE_MAX = 100;
/** `TimeLimitMinutes` in the spec: 1 minute to 8 hours, the length of a session. */
export const TIME_LIMIT_MIN = 1;
export const TIME_LIMIT_MAX = 480;

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
