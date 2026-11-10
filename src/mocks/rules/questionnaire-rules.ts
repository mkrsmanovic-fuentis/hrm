/*
 * Questionnaire rules the mock applies, mirrored from the "Questionnaires" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type {
  ActivationProblem,
  ActivationProblemCode,
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

/**
 * The API's `Questionnaire`: the stored record plus its derived `questionCount` and
 * `activationProblems`, which is always empty for an active questionnaire.
 */
export function toQuestionnaire(
  record: QuestionnaireRecord,
  data: Pick<MockData, 'questions' | 'answerOptions' | 'topics'>,
): Questionnaire {
  return {
    ...record,
    questionCount: questionCount(record, data),
    activationProblems: record.status === 'active' ? [] : activationProblems(record, data),
  };
}

/**
 * The checks before activation, mirrored from "Checks before activation" in
 * docs/developer-guide/business-rules.mdx: why the questionnaire cannot be activated, as the
 * `ActivationProblem` list of the `409` and of the derived `activationProblems`. Empty when it
 * can be activated.
 *
 * In this order: the questions of the current version, in order, with the completeness rule that
 * saving an active questionnaire uses too (`completenessIssues()`, behind
 * `questionSetProblems()`), then the topic, which must be active. Pass the record as it would be
 * after the request, so a request that also moves the questionnaire is checked against the new
 * topic.
 */
export function activationProblems(
  record: Pick<QuestionnaireRecord, 'currentVersionId' | 'topicId'>,
  data: Pick<MockData, 'questions' | 'answerOptions' | 'topics'>,
): ActivationProblem[] {
  const questions = questionsOfVersion(record.currentVersionId, data);
  const problems: ActivationProblem[] = completenessIssues(questions).map((issue) => {
    if (issue.questionIndex === null) {
      return {
        code: issue.code,
        questionId: null,
        questionNumber: null,
        message: 'The questionnaire has no questions. Add at least one question.',
      };
    }
    const number = issue.questionIndex + 1;
    return {
      code: issue.code,
      questionId: questions[issue.questionIndex].id,
      questionNumber: number,
      message: activationMessage(issue, number),
    };
  });
  const topic = data.topics.find((candidate) => candidate.id === record.topicId);
  if (topic && topic.status !== 'active') {
    problems.push({
      code: 'topic_inactive',
      questionId: null,
      questionNumber: null,
      message: `The topic ${topic.name} is inactive. Choose another topic, or reactivate the topic.`,
    });
  }
  return problems;
}

/** The `detail` of the `409` when activating is refused. */
export function activationRefusedDetail(problems: readonly ActivationProblem[]): string {
  const count = problems.length === 1 ? '1 problem' : `${problems.length} problems`;
  return `This questionnaire can't be activated yet. Fix ${count} first.`;
}

function activationMessage(issue: CompletenessIssue, number: number): string {
  switch (issue.code) {
    case 'question_text_missing':
      return `Question ${number} has no text. Enter the question.`;
    case 'answer_option_text_missing':
      return `Answer ${answerLetter(issue.optionIndex ?? 0)} of question ${number} is empty. Enter the answer, or remove it.`;
    case 'too_few_answer_options':
      return `Question ${number} has fewer than ${MIN_ANSWER_OPTIONS} answer options. Add at least ${MIN_ANSWER_OPTIONS}.`;
    case 'no_correct_answer':
      return `Question ${number} has no correct answer. Choose one.`;
    default:
      return `Question ${number} has more than one correct answer. Only one answer can be correct.`;
  }
}

/** "A", "B", … "Z", then "27", "28", …: as the question editor labels answer options. */
function answerLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/**
 * Whether the questionnaire has ever been active, read from its audit log entries: it was
 * created active (only seed data is), or it has an `activated`, `reactivated` or `deactivated`
 * entry. Activating a questionnaire that has never been active is logged as `activated`; any
 * later activation as `reactivated`.
 */
export function hasBeenActive(
  record: Pick<QuestionnaireRecord, 'id'>,
  data: Pick<MockData, 'auditLog'>,
): boolean {
  return data.auditLog.some(
    (entry) =>
      entry.entityType === 'questionnaire' &&
      entry.entityId === record.id &&
      (entry.action === 'activated' ||
        entry.action === 'reactivated' ||
        entry.action === 'deactivated' ||
        (entry.action === 'created' &&
          entry.changes.some(
            (change) => change.field === 'status' && change.newValue === 'active',
          ))),
  );
}

/** The parts of a question that decide whether it is complete. */
export interface QuestionShape {
  text: string;
  answerOptions: readonly { text: string; isCorrect: boolean }[];
}

/** One reason a list of questions is not complete. `questionIndex` is `null` for no questions. */
export interface CompletenessIssue {
  code: Exclude<ActivationProblemCode, 'topic_inactive'>;
  questionIndex: number | null;
  /** The empty answer option, for `answer_option_text_missing`. */
  optionIndex?: number;
}

/**
 * The completeness rule, shared by saving an active questionnaire (`questionSetProblems()`) and
 * activating one (`activationProblems()`): at least one question, and every question with text,
 * no empty answer option, at least two answer options and exactly one correct answer. Listed
 * question by question, each in that order.
 */
export function completenessIssues(questions: readonly QuestionShape[]): CompletenessIssue[] {
  if (questions.length === 0) return [{ code: 'no_questions', questionIndex: null }];
  return questions.flatMap((question, questionIndex) => {
    const issues: CompletenessIssue[] = [];
    if (question.text.trim() === '') issues.push({ code: 'question_text_missing', questionIndex });
    question.answerOptions.forEach((option, optionIndex) => {
      if (option.text.trim() === '') {
        issues.push({ code: 'answer_option_text_missing', questionIndex, optionIndex });
      }
    });
    if (question.answerOptions.length < MIN_ANSWER_OPTIONS) {
      issues.push({ code: 'too_few_answer_options', questionIndex });
    }
    const correct = question.answerOptions.filter((option) => option.isCorrect).length;
    if (correct === 0) issues.push({ code: 'no_correct_answer', questionIndex });
    if (correct > 1) issues.push({ code: 'several_correct_answers', questionIndex });
    return issues;
  });
}

/**
 * Why a list of questions is not complete, as field errors with the API's field names: the
 * `completenessIssues()` of the list.
 *
 * - `questions` (`too_short`): there are no questions.
 * - `questions[i].text` and `questions[i].answerOptions[j].text` (`required`): empty text. The
 *   request body reader refuses empty text first, so a save never gets these from here.
 * - `questions[i].answerOptions` (`too_short`): a question has fewer than two answer options.
 * - `questions[i].answerOptions` (`invalid_value`): a question does not have exactly one correct
 *   answer.
 *
 * Empty when the questions are complete. An active questionnaire must always be complete, so
 * saving questions that are not answers `422` with these errors; an inactive draft may be saved
 * incomplete.
 */
export function questionSetProblems(questions: readonly QuestionShape[]): FieldError[] {
  const error = (field: string, code: string, message: string): FieldError => ({
    location: 'body',
    field,
    code,
    message,
  });
  return completenessIssues(questions).map(({ code, questionIndex, optionIndex }) => {
    const question = `questions[${questionIndex}]`;
    switch (code) {
      case 'no_questions':
        return error('questions', 'too_short', 'Add at least one question.');
      case 'question_text_missing':
        return error(`${question}.text`, 'required', 'Required.');
      case 'answer_option_text_missing':
        return error(`${question}.answerOptions[${optionIndex}].text`, 'required', 'Required.');
      case 'too_few_answer_options':
        return error(
          `${question}.answerOptions`,
          'too_short',
          `Add at least ${MIN_ANSWER_OPTIONS} answer options.`,
        );
      case 'no_correct_answer':
        return error(`${question}.answerOptions`, 'invalid_value', 'Choose the correct answer.');
      case 'several_correct_answers':
        return error(
          `${question}.answerOptions`,
          'invalid_value',
          'Only one answer can be correct.',
        );
    }
  });
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
