import type {
  AnswerOption,
  Attempt,
  AttemptAnswer,
  AuditLogEntry,
  Notification,
  Role,
} from '../../app/core/api/api-schema.gen';
import { auditChanges } from '../db/audit';
import type {
  AssignmentRecord,
  DepartmentRecord,
  MockData,
  QuestionnaireRecord,
  QuestionnaireVersionRecord,
  QuestionRecord,
  TopicRecord,
  UserRecord,
} from '../db/mock-data';
import {
  DEADLINE_REMINDER_MS,
  INVITATION_LIFETIME_MS,
  isPassing,
  minimumCorrectToPass,
  scoreOf,
} from '../rules/training-rules';
import {
  draftQuestionnaireSeeds,
  questionnaireSeeds,
  topicSeeds,
  type DraftQuestionSeed,
} from './content.seed';
import { departmentSeeds, organizationSeed, userSeeds } from './people.seed';
import { SeededRandom } from './random';

/**
 * Bump when the seed or the shape of stored records changes. Browsers holding data from an
 * older version start again from the new seed on their next load.
 */
export const SEED_VERSION = 7;

const RANDOM_SEED = 20261110;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Days employees get to complete an assignment in the seed. */
const DEADLINE_DAYS = 30;

type Outcome = 'pass' | 'fail' | 'open';

interface Scenario {
  /** Range of days ago the assignment was created. */
  createdDaysAgo: [min: number, max: number];
  /** Possible attempt sequences. */
  outcomes: Outcome[][];
  /** The passing attempt was submitted after the deadline. */
  late?: boolean;
}

/** Weighted mix of assignment histories, so every status shows up with realistic frequency. */
const scenarios: [Scenario, number][] = [
  [{ createdDaysAgo: [10, 120], outcomes: [['pass']] }, 30],
  [
    {
      createdDaysAgo: [20, 120],
      outcomes: [
        ['fail', 'pass'],
        ['fail', 'fail', 'pass'],
      ],
    },
    10,
  ],
  [{ createdDaysAgo: [45, 100], outcomes: [['pass'], ['fail', 'pass']], late: true }, 5],
  [{ createdDaysAgo: [3, 25], outcomes: [['fail'], ['fail', 'fail']] }, 10],
  [{ createdDaysAgo: [2, 25], outcomes: [['open'], ['fail', 'open']] }, 10],
  [{ createdDaysAgo: [1, 25], outcomes: [[]] }, 15],
  [{ createdDaysAgo: [35, 90], outcomes: [[], ['fail'], ['open']] }, 20],
];

/**
 * Builds the seed dataset: one organization with departments, 42 users, the 7 FRD topics and a
 * retired one, questionnaires with versions, three drafts that cannot be activated yet (no
 * questions, incomplete questions, an inactive topic), and assignments and attempts in every
 * status.
 * The same `now` always gives the same data. Dates are relative to `now`.
 */
export function buildSeed(now: Date = new Date()): MockData {
  const random = new SeededRandom(RANDOM_SEED);
  const nowMs = now.getTime();
  const iso = (ms: number) => new Date(Math.min(ms, nowMs)).toISOString();
  const isoAny = (ms: number) => new Date(ms).toISOString();
  const daysAgo = (days: number) => nowMs - days * DAY - random.int(0, 8 * 60) * MINUTE;

  // ---------------------------------------------------------------- organization and roles

  const organizationId = random.uuid();
  const orgCreated = nowMs - 400 * DAY;
  const record = (createdMs: number, updatedMs = createdMs) => ({
    id: random.uuid(),
    organizationId,
    createdAt: iso(createdMs),
    updatedAt: iso(updatedMs),
  });

  const organization = {
    id: organizationId,
    name: organizationSeed.name,
    createdAt: iso(orgCreated),
    updatedAt: iso(orgCreated),
  };

  const roles: Role[] = [
    { ...record(orgCreated), key: 'administrator', name: 'Administrator' },
    { ...record(orgCreated), key: 'employee', name: 'Employee' },
  ];

  // ---------------------------------------------------------------- departments and users

  const departments: DepartmentRecord[] = departmentSeeds.map((seed, index) => {
    const created = orgCreated + 5 * DAY + index * HOUR;
    return {
      ...record(created, seed.status === 'inactive' ? nowMs - 60 * DAY : created),
      name: seed.name,
      description: seed.description,
      status: seed.status,
    };
  });
  const departmentId = (name: string | null) =>
    departments.find((d) => d.name === name)?.id ?? null;

  const users: UserRecord[] = userSeeds.map((seed, index) => {
    const email = `${slug(seed.firstName)}.${slug(seed.lastName)}@${organizationSeed.emailDomain}`;
    let created: number;
    let updated: number;
    let invitationSentAt: string | null = null;
    let invitationExpiresAt: string | null = null;
    let passwordSetAt: string | null = null;
    let lastSignedInAt: string | null = null;

    if (seed.role === 'administrator') {
      created = orgCreated + DAY + index * HOUR;
    } else if (seed.state === 'invited') {
      created = daysAgo(random.int(1, 5));
    } else if (seed.state === 'invite_expired') {
      created = daysAgo(20);
    } else {
      // Even positions joined early enough to have the retired 2025 password training.
      created = index % 2 === 0 ? daysAgo(random.int(310, 380)) : daysAgo(random.int(130, 300));
    }
    updated = created;

    if (seed.state === 'invited' || seed.state === 'invite_expired') {
      invitationSentAt = iso(created);
      invitationExpiresAt = isoAny(created + INVITATION_LIFETIME_MS);
    } else {
      passwordSetAt = iso(created + random.int(2, 30) * HOUR);
      lastSignedInAt = iso(
        seed.state === 'inactive' ? daysAgo(random.int(30, 60)) : daysAgo(random.int(0, 10)),
      );
    }
    if (seed.state === 'inactive') updated = nowMs - 25 * DAY;

    return {
      ...record(created, updated),
      email,
      firstName: seed.firstName,
      lastName: seed.lastName,
      role: seed.role,
      departmentId: departmentId(seed.department),
      status: seed.state === 'inactive' ? 'inactive' : 'active',
      invitationSentAt,
      invitationExpiresAt,
      passwordSetAt,
      lastSignedInAt,
    };
  });
  const admins = users.filter((user) => user.role === 'administrator');

  // ---------------------------------------------------------------- topics and questionnaires

  const topics: TopicRecord[] = topicSeeds.map((seed, index) => {
    const created = orgCreated + 10 * DAY + index * HOUR;
    return {
      ...record(created, seed.status === 'inactive' ? nowMs - 90 * DAY : created),
      name: seed.name,
      description: seed.description,
      icon: seed.icon,
      status: seed.status,
    };
  });

  const questionnaires: QuestionnaireRecord[] = [];
  const questionnaireVersions: QuestionnaireVersionRecord[] = [];
  const questions: QuestionRecord[] = [];
  const answerOptions: AnswerOption[] = [];

  interface BuiltQuestionnaire {
    record: QuestionnaireRecord;
    /** Versions, oldest first, with their questions and correct option ids. */
    versions: {
      id: string;
      createdMs: number;
      questions: { id: string; options: string[]; correct: string }[];
    }[];
  }
  const built: BuiltQuestionnaire[] = [];

  const addVersion = (
    questionnaireId: string,
    versionNumber: number,
    createdMs: number,
    seeds: readonly DraftQuestionSeed[],
  ) => {
    const version = { ...record(createdMs), questionnaireId, versionNumber };
    questionnaireVersions.push(version);
    const versionQuestions = seeds.map((seed, position) => {
      const question: QuestionRecord = {
        ...record(createdMs),
        questionnaireVersionId: version.id,
        position: position + 1,
        text: seed.text,
        explanation: seed.explanation,
      };
      questions.push(question);
      const options = seed.options.map((text, optionIndex) => {
        const option: AnswerOption = {
          ...record(createdMs),
          questionId: question.id,
          position: optionIndex + 1,
          text,
          isCorrect: optionIndex === seed.correct,
        };
        answerOptions.push(option);
        return option.id;
      });
      // Only drafts have questions without a correct answer, and nobody answers them.
      return { id: question.id, options, correct: options[seed.correct ?? -1] };
    });
    return { id: version.id, createdMs, questions: versionQuestions };
  };

  questionnaireSeeds.forEach((seed, index) => {
    const topic = topics.find((t) => t.name === seed.topic);
    if (!topic)
      throw new Error(`Seed questionnaire "${seed.title}" has unknown topic "${seed.topic}"`);
    const created =
      seed.status === 'inactive' ? nowMs - 360 * DAY : nowMs - (300 - index * 15) * DAY;
    const id = random.uuid();
    const versions = [addVersion(id, 1, created, seed.questions)];
    if (seed.addedInVersion2) {
      versions.push(
        addVersion(id, 2, nowMs - 60 * DAY, [...seed.questions, ...seed.addedInVersion2]),
      );
    }
    const latest = versions[versions.length - 1];
    const updated = seed.status === 'inactive' ? nowMs - 140 * DAY : latest.createdMs;
    const questionnaire: QuestionnaireRecord = {
      id,
      organizationId,
      topicId: topic.id,
      title: seed.title,
      description: seed.description,
      passingScore: seed.passingScore,
      timeLimitMinutes: seed.timeLimitMinutes,
      status: seed.status,
      currentVersionId: latest.id,
      createdAt: iso(created),
      updatedAt: iso(updated),
    };
    questionnaires.push(questionnaire);
    built.push({ record: questionnaire, versions });
  });

  // ---------------------------------------------------------------- assignments and attempts

  const assignments: AssignmentRecord[] = [];
  const attempts: Attempt[] = [];
  const attemptAnswers: AttemptAnswer[] = [];

  const versionAt = (questionnaire: BuiltQuestionnaire, ms: number) =>
    [...questionnaire.versions].reverse().find((version) => version.createdMs <= ms) ??
    questionnaire.versions[0];

  const addAttempt = (
    assignment: AssignmentRecord,
    questionnaire: BuiltQuestionnaire,
    attemptNumber: number,
    outcome: Outcome,
    startedMs: number,
  ): number => {
    const { passingScore, timeLimitMinutes } = questionnaire.record;
    const version = versionAt(questionnaire, startedMs);
    const n = version.questions.length;
    const expiresMs = timeLimitMinutes ? startedMs + timeLimitMinutes * MINUTE : null;
    const attemptId = random.uuid();
    const base = { organizationId, attemptId };

    if (outcome === 'open') {
      const answered = random.int(0, n - 1);
      let lastMs = startedMs;
      version.questions.slice(0, answered).forEach((question) => {
        lastMs += random.int(20, 90) * 1000;
        attemptAnswers.push({
          ...base,
          id: random.uuid(),
          questionId: question.id,
          answerOptionId: random.pick(question.options),
          isCorrect: null,
          createdAt: iso(lastMs),
          updatedAt: iso(lastMs),
        });
      });
      attempts.push({
        id: attemptId,
        organizationId,
        assignmentId: assignment.id,
        questionnaireVersionId: version.id,
        attemptNumber,
        status: 'in_progress',
        startedAt: iso(startedMs),
        expiresAt: expiresMs === null ? null : isoAny(expiresMs),
        submittedAt: null,
        submissionType: null,
        passingScore,
        questionCount: n,
        correctCount: null,
        score: null,
        passed: null,
        createdAt: iso(startedMs),
        updatedAt: iso(lastMs),
      });
      return lastMs;
    }

    const minPass = minimumCorrectToPass(n, passingScore);
    const correctCount =
      outcome === 'pass'
        ? random.int(minPass, n)
        : random.int(Math.max(0, minPass - 2), minPass - 1);
    const timedOut = outcome === 'fail' && expiresMs !== null && random.chance(0.3);
    const maxMinutes = timeLimitMinutes ? timeLimitMinutes - 1 : 14;
    const submittedMs =
      timedOut && expiresMs !== null ? expiresMs : startedMs + random.int(3, maxMinutes) * MINUTE;

    const order = random.shuffle(version.questions.map((_, i) => i));
    const correctSet = new Set(order.slice(0, correctCount));
    const wrong = order.slice(correctCount);
    const unanswered = new Set(timedOut ? wrong.slice(0, Math.min(2, wrong.length)) : []);

    version.questions.forEach((question, index) => {
      if (unanswered.has(index)) {
        attemptAnswers.push({
          ...base,
          id: random.uuid(),
          questionId: question.id,
          answerOptionId: null,
          isCorrect: false,
          createdAt: iso(submittedMs),
          updatedAt: iso(submittedMs),
        });
        return;
      }
      const isCorrect = correctSet.has(index);
      const answeredMs = startedMs + ((index + 1) / (n + 1)) * (submittedMs - startedMs);
      attemptAnswers.push({
        ...base,
        id: random.uuid(),
        questionId: question.id,
        answerOptionId: isCorrect
          ? question.correct
          : random.pick(question.options.filter((o) => o !== question.correct)),
        isCorrect,
        createdAt: iso(answeredMs),
        updatedAt: iso(answeredMs),
      });
    });

    const score = scoreOf(correctCount, n);
    attempts.push({
      id: attemptId,
      organizationId,
      assignmentId: assignment.id,
      questionnaireVersionId: version.id,
      attemptNumber,
      status: 'submitted',
      startedAt: iso(startedMs),
      expiresAt: expiresMs === null ? null : isoAny(expiresMs),
      submittedAt: iso(submittedMs),
      submissionType: timedOut ? 'time_limit' : 'employee',
      passingScore,
      questionCount: n,
      correctCount,
      score,
      passed: isPassing(score, passingScore),
      createdAt: iso(startedMs),
      updatedAt: iso(submittedMs),
    });
    return submittedMs;
  };

  const addAssignment = (
    user: UserRecord,
    questionnaire: BuiltQuestionnaire,
    createdMs: number,
    outcomes: Outcome[],
    late = false,
  ) => {
    const dueMs = createdMs + DEADLINE_DAYS * DAY;
    const assignment: AssignmentRecord = {
      ...record(createdMs),
      questionnaireId: questionnaire.record.id,
      userId: user.id,
      assignedById: random.pick(admins).id,
      dueAt: isoAny(dueMs),
    };
    assignments.push(assignment);

    // Attempts happen between assignment and deadline (or now), the last one after the deadline when late.
    const windowEnd = Math.min(dueMs, nowMs) - HOUR;
    let lastMs = createdMs;
    outcomes.forEach((outcome, index) => {
      const isLast = index === outcomes.length - 1;
      let startedMs: number;
      if (late && isLast) {
        const daysLate = Math.max(1, Math.min(10, Math.floor((nowMs - dueMs) / DAY) - 1));
        startedMs = dueMs + random.int(1, daysLate) * DAY - random.int(1, 8) * HOUR;
      } else if (outcome === 'open' && dueMs > nowMs) {
        startedMs = nowMs - random.int(1, 48) * HOUR;
      } else {
        const slot = (windowEnd - createdMs) / (outcomes.length + 1);
        startedMs = createdMs + slot * (index + 1) + random.int(-4, 4) * HOUR;
      }
      startedMs = Math.max(startedMs, lastMs + HOUR);
      lastMs = addAttempt(assignment, questionnaire, index + 1, outcome, startedMs);
    });
    assignment.updatedAt = iso(lastMs);
    return assignment;
  };

  const active = built.filter((q) => q.record.status === 'active');
  const retired = built.filter((q) => q.record.status === 'inactive');
  const employees = users.filter((user) => user.role === 'employee');

  employees.forEach((user, index) => {
    const seed = userSeeds[users.indexOf(user)];
    if (seed.state === 'invited' || seed.state === 'invite_expired') {
      addAssignment(user, random.pick(active), Date.parse(user.createdAt) + HOUR, []);
      return;
    }
    const chosen = random.shuffle(active).slice(0, random.int(2, 4));
    for (const questionnaire of chosen) {
      if (seed.state === 'inactive') {
        // History up to the deactivation 25 days ago; open work stays as it was.
        const passed = random.chance(0.5);
        addAssignment(
          user,
          questionnaire,
          daysAgo(random.int(passed ? 60 : 35, 120)),
          passed ? ['pass'] : [],
        );
        continue;
      }
      const scenario = random.weighted(scenarios);
      let outcomes = random.pick(scenario.outcomes);
      // Open attempts on timed questionnaires would have been submitted by now.
      if (outcomes.includes('open') && questionnaire.record.timeLimitMinutes) {
        outcomes = outcomes.map((outcome) => (outcome === 'open' ? 'fail' : outcome));
      }
      const [min, max] = scenario.createdDaysAgo;
      addAssignment(user, questionnaire, daysAgo(random.int(min, max)), outcomes, scenario.late);
    }
    // Early joiners passed the retired 2025 password training.
    if (index % 2 === 0 && Date.parse(user.createdAt) < nowMs - 300 * DAY) {
      for (const questionnaire of retired) {
        addAssignment(user, questionnaire, daysAgo(random.int(200, 290)), ['pass']);
      }
    }
  });

  // ---------------------------------------------------------------- notifications

  const notifications: Notification[] = [];
  const addNotification = (
    assignment: AssignmentRecord,
    type: Notification['type'],
    createdMs: number,
  ) => {
    const readMs =
      createdMs < nowMs - 2 * DAY && random.chance(0.75)
        ? createdMs + random.int(1, 30) * HOUR
        : null;
    notifications.push({
      ...record(createdMs, readMs ?? createdMs),
      userId: assignment.userId,
      type,
      assignmentId: assignment.id,
      readAt: readMs === null ? null : iso(readMs),
    });
  };
  for (const assignment of assignments) {
    addNotification(assignment, 'assignment_created', Date.parse(assignment.createdAt) + MINUTE);
    const reminderMs = Date.parse(assignment.dueAt) - DEADLINE_REMINDER_MS;
    const passedAt = attempts.find(
      (a) => a.assignmentId === assignment.id && a.passed,
    )?.submittedAt;
    if (reminderMs <= nowMs && (!passedAt || Date.parse(passedAt) > reminderMs)) {
      addNotification(assignment, 'deadline_reminder', reminderMs);
    }
  }

  // ---------------------------------------------------------------- draft questionnaires

  // Built after everything else, so the random values of the data above stay the same.
  const drafts: QuestionnaireRecord[] = draftQuestionnaireSeeds.map((seed, index) => {
    const topic = topics.find((t) => t.name === seed.topic);
    if (!topic) throw new Error(`Seed draft "${seed.title}" has unknown topic "${seed.topic}"`);
    const createdMs = nowMs - (3 + index) * DAY;
    const id = random.uuid();
    const version = addVersion(id, 1, createdMs, seed.questions);
    const draft: QuestionnaireRecord = {
      id,
      organizationId,
      topicId: topic.id,
      title: seed.title,
      description: seed.description,
      passingScore: seed.passingScore,
      timeLimitMinutes: seed.timeLimitMinutes,
      status: 'inactive',
      currentVersionId: version.id,
      createdAt: iso(createdMs),
      updatedAt: iso(createdMs),
    };
    questionnaires.push(draft);
    return draft;
  });

  // ---------------------------------------------------------------- audit log

  const auditLog: AuditLogEntry[] = [];
  const audit = (
    entityType: AuditLogEntry['entityType'],
    entity: { id: string },
    action: AuditLogEntry['action'],
    atMs: number,
    changes: AuditLogEntry['changes'] = [],
    actorId = admins[0].id,
  ) =>
    auditLog.push({ ...record(atMs), actorId, action, entityType, entityId: entity.id, changes });
  // Created entries list the record as it was when created (active, before any sign-in).
  const created = <T extends object>(record: T, ...overrides: Partial<T>[]) =>
    auditChanges(null, Object.assign({}, record, ...overrides));

  departments.forEach((d) =>
    audit('department', d, 'created', Date.parse(d.createdAt), created(d, { status: 'active' })),
  );
  departments
    .filter((d) => d.status === 'inactive')
    .forEach((d) => audit('department', d, 'deactivated', Date.parse(d.updatedAt)));
  topics.forEach((t) =>
    audit('topic', t, 'created', Date.parse(t.createdAt), created(t, { status: 'active' })),
  );
  topics
    .filter((t) => t.status === 'inactive')
    .forEach((t) => audit('topic', t, 'deactivated', Date.parse(t.updatedAt)));
  built.forEach(({ record: q, versions }) => {
    const first = { status: 'active' as const, currentVersionId: versions[0].id };
    audit('questionnaire', q, 'created', Date.parse(q.createdAt), created(q, first));
    if (versions.length > 1) {
      const previous = versions[versions.length - 2].id;
      const latest = versions[versions.length - 1];
      audit('questionnaire', q, 'updated', latest.createdMs, [
        { field: 'currentVersionId', oldValue: previous, newValue: latest.id },
      ]);
    }
    if (q.status === 'inactive') audit('questionnaire', q, 'deactivated', Date.parse(q.updatedAt));
  });
  // New questionnaires start inactive, so a draft has only its `created` entry.
  drafts.forEach((q) => audit('questionnaire', q, 'created', Date.parse(q.createdAt), created(q)));
  employees.forEach((u) => {
    const createdMs = Date.parse(u.createdAt);
    const invited = {
      status: 'active' as const,
      invitationSentAt: u.createdAt,
      invitationExpiresAt: isoAny(createdMs + INVITATION_LIFETIME_MS),
      passwordSetAt: null,
      lastSignedInAt: null,
    };
    audit('user', u, 'created', createdMs, created(u, invited), random.pick(admins).id);
    if (u.status === 'inactive') audit('user', u, 'deactivated', Date.parse(u.updatedAt));
  });
  assignments.forEach((a) =>
    audit('assignment', a, 'created', Date.parse(a.createdAt), created(a), a.assignedById),
  );
  auditLog.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    organization,
    roles,
    users,
    departments,
    topics,
    questionnaires,
    questionnaireVersions,
    questions,
    answerOptions,
    assignments,
    attempts,
    attemptAnswers,
    notifications,
    auditLog,
    sessions: [],
  };
}

/** Lowercase ASCII for email addresses: "Petrović" → "petrovic", "O’Neill" → "oneill". */
function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z]/g, '');
}
