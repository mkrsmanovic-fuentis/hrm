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
  /** The saved question's ID, to find it from an activation problem. `null` for a new question. */
  id: string | null;
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
    id: null,
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
    id: question.id,
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

/*
 * A complete question, as an active questionnaire needs every question to be: at least two answer
 * options and exactly one correct answer. The same rule as the API's `questionSetProblems()`,
 * split in two so each problem shows next to what fixes it. Text is checked separately, with
 * `textRules()`.
 */

/** Why the question has too few answer options, or `null`. Shown under **Answer options**. */
export function answerOptionsProblem(question: DraftQuestion): string | null {
  return question.answerOptions.length < MIN_ANSWER_OPTIONS
    ? `Add at least ${MIN_ANSWER_OPTIONS} answer options.`
    : null;
}

/** Why the question does not have exactly one correct answer, or `null`. Shown under **Correct answer**. */
export function correctAnswerProblem(question: DraftQuestion): string | null {
  const correct = question.answerOptions.filter((option) => option.isCorrect).length;
  if (correct === 1) return null;
  return correct === 0 ? 'Choose the correct answer.' : 'Only one answer can be correct.';
}
