import type { QuestionInput, QuestionnaireVersion } from '../../core/api';

/** Limits from the API spec (`QuestionInput`, `AnswerOptionInput`). */
export const QUESTION_TEXT_MAX_LENGTH = 1000;
export const EXPLANATION_MAX_LENGTH = 2000;
export const OPTION_TEXT_MAX_LENGTH = 500;
/** A complete question has at least this many answer options. */
export const MIN_ANSWER_OPTIONS = 2;

/** One answer option in the editor's working copy. `key` only tracks it while editing. */
export interface DraftOption {
  key: string;
  text: string;
  isCorrect: boolean;
}

/** One question in the editor's working copy. `key` only tracks it while editing. */
export interface DraftQuestion {
  key: string;
  text: string;
  explanation: string;
  answerOptions: DraftOption[];
}

let nextKey = 0;
/** A key for a new item in the working copy, unique within the page. */
export function newKey(): string {
  nextKey += 1;
  return `draft-${nextKey}`;
}

/** A new, empty question with two empty answer options and no correct answer yet. */
export function emptyQuestion(): DraftQuestion {
  return {
    key: newKey(),
    text: '',
    explanation: '',
    answerOptions: [emptyOption(), emptyOption()],
  };
}

export function emptyOption(): DraftOption {
  return { key: newKey(), text: '', isCorrect: false };
}

/** The working copy of a version's questions. */
export function toDraft(version: QuestionnaireVersion): DraftQuestion[] {
  return version.questions.map((question) => ({
    key: newKey(),
    text: question.text,
    explanation: question.explanation ?? '',
    answerOptions: question.answerOptions.map((option) => ({
      key: newKey(),
      text: option.text,
      isCorrect: option.isCorrect,
    })),
  }));
}

/** The request body for the working copy: text trimmed, an empty explanation as `null`. */
export function toInput(questions: readonly DraftQuestion[]): QuestionInput[] {
  return questions.map((question) => ({
    text: question.text.trim(),
    explanation: question.explanation.trim() || null,
    answerOptions: question.answerOptions.map((option) => ({
      text: option.text.trim(),
      isCorrect: option.isCorrect,
    })),
  }));
}

/** Whether two working copies would save the same questions. */
export function sameQuestions(a: readonly DraftQuestion[], b: readonly DraftQuestion[]): boolean {
  return JSON.stringify(toInput(a)) === JSON.stringify(toInput(b));
}

/** A copy of `items` with the item at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** "A", "B", … "Z", then "27", "28", …: the label of the answer option at `index`. */
export function optionLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/**
 * What is wrong with the working copy, by the API's field names (`questions[0].text`, …), with
 * the same rules as the API:
 *
 * - Always: every question and answer option has text, within the length limits.
 * - Only when `complete` (an active questionnaire): at least one question, and each question has
 *   at least two answer options with exactly one correct. An inactive draft may be saved
 *   incomplete.
 */
export function draftErrors(
  questions: readonly DraftQuestion[],
  complete: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (complete && questions.length === 0) errors['questions'] = 'Add at least one question.';
  questions.forEach((question, index) => {
    const path = `questions[${index}]`;
    const text = question.text.trim();
    if (!text) errors[`${path}.text`] = 'Enter the question.';
    else if (text.length > QUESTION_TEXT_MAX_LENGTH) {
      errors[`${path}.text`] = tooLong(QUESTION_TEXT_MAX_LENGTH);
    }
    if (question.explanation.trim().length > EXPLANATION_MAX_LENGTH) {
      errors[`${path}.explanation`] = tooLong(EXPLANATION_MAX_LENGTH);
    }
    question.answerOptions.forEach((option, optionIndex) => {
      const optionText = option.text.trim();
      const field = `${path}.answerOptions[${optionIndex}].text`;
      if (!optionText) errors[field] = 'Enter the answer.';
      else if (optionText.length > OPTION_TEXT_MAX_LENGTH)
        errors[field] = tooLong(OPTION_TEXT_MAX_LENGTH);
    });
    if (complete) {
      const problems: string[] = [];
      if (question.answerOptions.length < MIN_ANSWER_OPTIONS) {
        problems.push(`Add at least ${MIN_ANSWER_OPTIONS} answer options.`);
      }
      const correct = question.answerOptions.filter((option) => option.isCorrect).length;
      if (correct !== 1) {
        problems.push(
          correct === 0 ? 'Choose the correct answer.' : 'Only one answer can be correct.',
        );
      }
      if (problems.length > 0) errors[`${path}.answerOptions`] = problems.join(' ');
    }
  });
  return errors;
}

function tooLong(max: number): string {
  return `Must be ${max.toLocaleString('en-US')} characters or fewer.`;
}
