import type { AnswerOption, AuditLogEntry } from '../../app/core/api/api-schema.gen';
import type { MockData, QuestionRecord, TopicRecord } from '../db/mock-data';
import {
  activationProblems,
  activationRefusedDetail,
  hasBeenActive,
  questionSetProblems,
  toQuestionnaire,
} from './questionnaire-rules';

type RuleData = Pick<MockData, 'questions' | 'answerOptions' | 'topics'>;

/** A question of the test version: text and its options, `*` marking a correct one. */
type QuestionSpec = [text: string, ...options: string[]];

const at = '2026-11-10T10:00:00.000Z';
const base = { organizationId: 'org', createdAt: at, updatedAt: at };

function topic(status: TopicRecord['status']): TopicRecord {
  return { ...base, id: 'topic', name: 'Phishing Awareness', description: 'D', icon: null, status };
}

/** Test data with one version, `v1`, holding these questions, in a topic with this status. */
function build(specs: QuestionSpec[], topicStatus: TopicRecord['status'] = 'active'): RuleData {
  const questions: QuestionRecord[] = [];
  const answerOptions: AnswerOption[] = [];
  specs.forEach(([text, ...options], index) => {
    const id = `q${index + 1}`;
    questions.push({
      ...base,
      id,
      questionnaireVersionId: 'v1',
      position: index + 1,
      text,
      explanation: null,
    });
    options.forEach((option, optionIndex) => {
      answerOptions.push({
        ...base,
        id: `${id}-o${optionIndex + 1}`,
        questionId: id,
        position: optionIndex + 1,
        text: option.replace(/^\*/, ''),
        isCorrect: option.startsWith('*'),
      });
    });
  });
  return { questions, answerOptions, topics: [topic(topicStatus)] };
}

const record = {
  ...base,
  id: 'questionnaire',
  topicId: 'topic',
  title: 'Spotting phishing',
  description: null,
  passingScore: 80,
  timeLimitMinutes: null,
  status: 'inactive' as const,
  currentVersionId: 'v1',
};

const codes = (data: RuleData) => activationProblems(record, data).map((p) => p.code);

describe('activationProblems', () => {
  it('passes a questionnaire with complete questions in an active topic', () => {
    const data = build([
      ['What is phishing?', '*A scam', 'A sport'],
      ['Report it?', 'No', '*Yes', 'Later'],
    ]);

    expect(activationProblems(record, data)).toEqual([]);
  });

  it('blocks a questionnaire without questions', () => {
    expect(activationProblems(record, build([]))).toEqual([
      {
        code: 'no_questions',
        questionId: null,
        questionNumber: null,
        message: 'The questionnaire has no questions. Add at least one question.',
      },
    ]);
  });

  it('names the question and what is wrong with it, for every kind of problem', () => {
    const data = build([
      ['Complete', '*Yes', 'No'],
      ['', '*Yes', 'No'],
      ['Empty option', '*Yes', ' '],
      ['One option', '*Yes'],
      ['No correct answer', 'Yes', 'No'],
      ['Two correct answers', '*Yes', '*No'],
    ]);

    expect(activationProblems(record, data)).toEqual([
      {
        code: 'question_text_missing',
        questionId: 'q2',
        questionNumber: 2,
        message: 'Question 2 has no text. Enter the question.',
      },
      {
        code: 'answer_option_text_missing',
        questionId: 'q3',
        questionNumber: 3,
        message: 'Answer B of question 3 is empty. Enter the answer, or remove it.',
      },
      {
        code: 'too_few_answer_options',
        questionId: 'q4',
        questionNumber: 4,
        message: 'Question 4 has fewer than 2 answer options. Add at least 2.',
      },
      {
        code: 'no_correct_answer',
        questionId: 'q5',
        questionNumber: 5,
        message: 'Question 5 has no correct answer. Choose one.',
      },
      {
        code: 'several_correct_answers',
        questionId: 'q6',
        questionNumber: 6,
        message: 'Question 6 has more than one correct answer. Only one answer can be correct.',
      },
    ]);
  });

  it('lists every problem of one question, and a question without options twice', () => {
    expect(codes(build([['No options']]))).toEqual(['too_few_answer_options', 'no_correct_answer']);
  });

  it('numbers questions by their position, not by the order they are stored in', () => {
    const data = build([
      ['First', '*Yes', 'No'],
      ['Second', 'Yes', 'No'],
    ]);
    data.questions.reverse();

    expect(activationProblems(record, data)[0]).toMatchObject({
      questionId: 'q2',
      questionNumber: 2,
    });
  });

  it('blocks a questionnaire in an inactive topic, after the problems with questions', () => {
    const data = build([['No correct answer', 'Yes', 'No']], 'inactive');

    expect(activationProblems(record, data)).toEqual([
      expect.objectContaining({ code: 'no_correct_answer' }),
      {
        code: 'topic_inactive',
        questionId: null,
        questionNumber: null,
        message:
          'The topic Phishing Awareness is inactive. Choose another topic, or reactivate the topic.',
      },
    ]);
  });

  it('is the derived activationProblems of an inactive questionnaire, and empty for an active one', () => {
    const data = build([], 'inactive');

    expect(toQuestionnaire(record, data).activationProblems.map((p) => p.code)).toEqual([
      'no_questions',
      'topic_inactive',
    ]);
    expect(toQuestionnaire({ ...record, status: 'active' }, data).activationProblems).toEqual([]);
  });

  it('sums the problems up for the 409 detail', () => {
    const one = activationProblems(record, build([]));
    const two = activationProblems(record, build([], 'inactive'));

    expect(activationRefusedDetail(one)).toBe(
      "This questionnaire can't be activated yet. Fix 1 problem first.",
    );
    expect(activationRefusedDetail(two)).toBe(
      "This questionnaire can't be activated yet. Fix 2 problems first.",
    );
  });
});

describe('questionSetProblems', () => {
  const shape = (text: string, ...options: string[]) => ({
    text,
    answerOptions: options.map((option) => ({
      text: option.replace(/^\*/, ''),
      isCorrect: option.startsWith('*'),
    })),
  });

  it('gives the same rule as field errors with the API field names', () => {
    expect(questionSetProblems([])).toEqual([
      {
        location: 'body',
        field: 'questions',
        code: 'too_short',
        message: 'Add at least one question.',
      },
    ]);
    expect(
      questionSetProblems([
        shape('Fine', '*A', 'B'),
        shape('', '*A', ''),
        shape('Q', 'A', '*B', '*C'),
      ]).map((e) => [e.field, e.code, e.message]),
    ).toEqual([
      ['questions[1].text', 'required', 'Required.'],
      ['questions[1].answerOptions[1].text', 'required', 'Required.'],
      ['questions[2].answerOptions', 'invalid_value', 'Only one answer can be correct.'],
    ]);
  });
});

describe('hasBeenActive', () => {
  const entry = (action: AuditLogEntry['action'], changes: AuditLogEntry['changes'] = []) => ({
    auditLog: [
      {
        ...base,
        id: 'e',
        actorId: 'admin',
        action,
        entityType: 'questionnaire' as const,
        entityId: record.id,
        changes,
      },
    ],
  });

  it('is false for a questionnaire created as a draft and never activated', () => {
    expect(hasBeenActive(record, { auditLog: [] })).toBe(false);
    expect(
      hasBeenActive(
        record,
        entry('created', [{ field: 'status', oldValue: null, newValue: 'inactive' }]),
      ),
    ).toBe(false);
    expect(hasBeenActive(record, entry('updated'))).toBe(false);
  });

  it('is true once it was created active, activated, reactivated or deactivated', () => {
    expect(
      hasBeenActive(
        record,
        entry('created', [{ field: 'status', oldValue: null, newValue: 'active' }]),
      ),
    ).toBe(true);
    for (const action of ['activated', 'reactivated', 'deactivated'] as const) {
      expect(hasBeenActive(record, entry(action)), action).toBe(true);
    }
  });

  it('only counts entries of the same questionnaire', () => {
    const data = entry('activated');
    data.auditLog[0].entityId = 'another';

    expect(hasBeenActive(record, data)).toBe(false);
  });
});
