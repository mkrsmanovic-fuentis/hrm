import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { SdList, SdStatusBar } from '@specora-dev/ui-kit';
import { of } from 'rxjs';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Assignment } from '../../core/api';
import { EmployeeTraining, scoreText } from './employee-training';

type Mock = ReturnType<typeof createTestMockApi>;

describe('Training history page', () => {
  async function render(
    pickUser: (mock: Mock) => string,
    options: TestMockApiOptions = {},
    prepare?: (mock: Mock) => void,
  ) {
    const mock = createTestMockApi(options);
    prepare?.(mock);
    const userId = pickUser(mock);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        ...mock.providers,
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ userId })) } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeeTraining);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
    await fixture.whenStable();

    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    const statusBar = () =>
      fixture.debugElement.query(By.directive(SdStatusBar)).componentInstance as SdStatusBar;
    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<Assignment> | undefined;
    const column = (id: string) => {
      const found = list()
        ?.columns()
        .find((c) => c.id === id);
      if (!found) throw new Error(`No column ${id}`);
      return found;
    };
    return { fixture, element, mock, userId, text, statusBar, list, column };
  }

  const named = (firstName: string) => (mock: Mock) => {
    const user = mock.db.data.users.find((u) => u.firstName === firstName);
    if (!user) throw new Error(`No seeded user ${firstName}`);
    return user.id;
  };

  it("shows an inactive employee's details and every assignment they have had, newest first", async () => {
    const { mock, userId, statusBar, list } = await render(named('Sofia'));
    const sofia = mock.db.data.users.find((u) => u.id === userId)!;
    const engineering = mock.db.data.departments.find((d) => d.id === sofia.departmentId)!;

    expect(statusBar().heading()).toBe('Sofia Lindqvist');
    expect(statusBar().subtitle()).toBe(sofia.email);
    expect(
      statusBar()
        .breadcrumb()
        .map((b) => b.label),
    ).toEqual(['Employees', 'Training history']);
    expect(statusBar().stats()).toEqual([
      { label: 'Department', value: engineering.name },
      { label: 'Status', badge: { label: 'Inactive', tone: 'muted' } },
    ]);

    const own = mock.db.data.assignments.filter((a) => a.userId === userId);
    expect(own.length).toBeGreaterThan(0);
    expect(
      list()
        ?.items()
        .map((a) => a.id)
        .sort(),
    ).toEqual(own.map((a) => a.id).sort());
    expect(list()?.sort()).toEqual({ columnId: 'createdAt', dir: 'desc' });
    expect(
      list()
        ?.columns()
        .map((c) => c.label),
    ).toEqual([
      'Questionnaire',
      'Topic',
      'Assigned',
      'Deadline',
      'Status',
      'Attempts',
      'Latest score',
      'Completed',
    ]);
  });

  it('shows status, attempts, the latest score rounded down and the completion date', async () => {
    const { list, column } = await render(named('Sofia'));
    const items = list()!.items();
    const passed = items.find((a) => a.status === 'passed')!;
    const open = items.find((a) => a.status !== 'passed')!;

    expect(column('status').value(passed)).toBe('Passed');
    expect(column('status').tone?.(passed)).toBe('success');
    expect(column('attemptCount').value(passed)).toBe(passed.attemptCount);
    expect(column('latestScore').value({ ...passed, latestScore: 79.6 })).toBe('79%');
    expect(column('completedAt').value(passed)).not.toBe('—');
    expect(column('latestScore').value({ ...open, latestScore: null })).toBe('—');
    expect(column('completedAt').value(open)).toBe('—');
    expect(column('completedAt').subValue?.(open)).toBeNull();
  });

  it('marks a pass after the deadline as late', async () => {
    const { list, column } = await render(named('Sofia'));
    const passed = list()!
      .items()
      .find((a) => a.status === 'passed')!;
    const late = {
      ...passed,
      completedAt: new Date(Date.parse(passed.dueAt) + 1000).toISOString(),
    };
    const onTime = {
      ...passed,
      completedAt: new Date(Date.parse(passed.dueAt) - 1000).toISOString(),
    };

    expect(column('completedAt').subValue?.(late)).toBe('Late');
    expect(column('completedAt').subValue?.(onTime)).toBeNull();
  });

  it('marks questionnaires and topics deactivated since assigning as inactive', async () => {
    let questionnaireId = '';
    const { list, column } = await render(named('Sofia'), {}, (mock) => {
      const sofia = mock.db.data.users.find((u) => u.firstName === 'Sofia')!;
      const assignment = mock.db.data.assignments.find((a) => a.userId === sofia.id)!;
      questionnaireId = assignment.questionnaireId;
      mock.db.update((data) => {
        const questionnaire = data.questionnaires.find((q) => q.id === questionnaireId)!;
        questionnaire.status = 'inactive';
        data.topics.find((t) => t.id === questionnaire.topicId)!.status = 'inactive';
      });
    });

    const items = list()!.items();
    const deactivated = items.find((a) => a.questionnaireId === questionnaireId)!;
    expect(column('questionnaire').subValue?.(deactivated)).toBe('Inactive questionnaire');
    expect(column('topic').value(deactivated)).toBe(deactivated.topicName);
    expect(column('topic').subValue?.(deactivated)).toBe('Inactive topic');
    const active = items.find(
      (a) => a.questionnaireStatus === 'active' && a.topicStatus === 'active',
    )!;
    expect(column('questionnaire').subValue?.(active)).toBeNull();
    expect(column('topic').subValue?.(active)).toBeNull();
  });

  it('says when someone has no training yet', async () => {
    const { text } = await render((mock) => {
      const user = mock.db.data.users.find(
        (u) => !mock.db.data.assignments.some((a) => a.userId === u.id),
      );
      if (!user) throw new Error('No user without assignments in the seed');
      return user.id;
    });

    expect(text()).toContain('No training assigned yet');
  });

  it('says when the employee does not exist', async () => {
    const { text, list } = await render(() => 'missing');

    expect(text()).toContain('Employee not found');
    expect(text()).toContain('All employees');
    expect(list()).toBeUndefined();
  });

  it('shows the no-access state on 403', async () => {
    const { element } = await render(named('Sofia'), { flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')).not.toBeNull();
  });

  it('shows an error with a retry button when loading fails', async () => {
    const { text } = await render(named('Sofia'), { flags: { errorStatus: 500 } });

    expect(text()).toContain('Could not load the training history');
    expect(text()).toContain('Try again');
  });

  it('rounds scores down to a whole percent', () => {
    expect(scoreText(79.6)).toBe('79%');
    expect(scoreText(100)).toBe('100%');
    expect(scoreText(0)).toBe('0%');
    expect(scoreText(null)).toBe('—');
  });
});
