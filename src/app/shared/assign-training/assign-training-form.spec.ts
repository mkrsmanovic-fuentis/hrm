import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { SdSelectOption } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import { type AssignTarget, AssignTrainingForm, endOfDay } from './assign-training-form';
import type { AssignTrainingResult } from './assign-training-result';

interface Model {
  questionnaireId: string | null;
  target: AssignTarget;
  userIds: string[];
  departmentId: string | null;
  deadline: Date | null;
}

describe('Assign training form', () => {
  /** A day well after both the test clock and the real one. */
  const DEADLINE = new Date(2030, 0, 15);

  async function render(questionnaireId: string | null = null, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const fixture = TestBed.createComponent(AssignTrainingForm);
    if (questionnaireId) fixture.componentRef.setInput('questionnaireId', questionnaireId);
    const saved: AssignTrainingResult[] = [];
    fixture.componentInstance.saved.subscribe((result) => saved.push(result));
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      loading: () => boolean;
      saving: () => boolean;
      questionnaireOptions: () => SdSelectOption<string>[];
      employeeOptions: () => SdSelectOption<string>[];
      departmentOptions: () => SdSelectOption<string>[];
      model: { set: (m: Model) => void; (): Model };
    };
    await vi.waitFor(() => expect(component.loading()).toBe(false));
    await fixture.whenStable();

    const drawerText = () => document.querySelector('sd-drawer')?.textContent ?? '';
    const fill = async (model: Partial<Model>) => {
      component.model.set({ ...component.model(), ...model });
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-drawer button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() => expect(component.saving()).toBe(false));
      await fixture.whenStable();
    };
    const user = (firstName: string) => mock.db.data.users.find((u) => u.firstName === firstName)!;
    const questionnaire = (title: string) =>
      mock.db.data.questionnaires.find((q) => q.title === title)!;
    return { fixture, mock, component, saved, drawerText, fill, submit, user, questionnaire };
  }

  it('offers only active questionnaires in active topics, active employees and active departments', async () => {
    const { component, mock } = await render();
    const { data } = mock.db;

    const questionnaires = component.questionnaireOptions().map((o) => o.label);
    expect(questionnaires).toContain('Handling personal data');
    expect(questionnaires).not.toContain('Password basics (2025)');
    expect(questionnaires).not.toContain('Clean desk checklist');

    const employees = component.employeeOptions().map((o) => o.label);
    expect(employees).toContain('Amelia Hughes');
    // Administrators and inactive users can't be assigned.
    expect(employees).not.toContain('Maja Novak');
    expect(employees).not.toContain('Sofia Lindqvist');
    expect(employees).toHaveLength(
      data.users.filter((u) => u.role === 'employee' && u.status === 'active').length,
    );
    expect(
      component.employeeOptions().find((o) => o.label === 'Patrick O’Neill')?.description,
    ).toBe('Facilities');

    const departments = component.departmentOptions().map((o) => o.label);
    expect(departments).toContain('Engineering');
    expect(departments).not.toContain('Facilities');
  });

  it('starts with the questionnaire it was opened for', async () => {
    const { component } = await render('a-questionnaire-id');

    expect(component.model().questionnaireId).toBe('a-questionnaire-id');
  });

  it('asks for a questionnaire, employees and a deadline', async () => {
    const { submit, drawerText, saved, fill } = await render();

    await submit();

    expect(drawerText()).toContain('Choose a questionnaire.');
    expect(drawerText()).toContain('Choose at least one employee.');
    expect(drawerText()).toContain('Choose a deadline.');

    await fill({ target: 'department' });
    expect(drawerText()).toContain('Choose a department.');
    expect(saved).toEqual([]);
  });

  it('assigns selected employees, with the end of the chosen day as the deadline', async () => {
    const { fill, submit, saved, user, questionnaire, mock } = await render();
    const ruth = user('Ruth');
    const benjamin = user('Benjamin');
    const target = questionnaire('Handling personal data');
    // Clear their history for this questionnaire, so neither is skipped.
    mock.db.update((data) => {
      data.assignments = data.assignments.filter(
        (a) => a.questionnaireId !== target.id || ![ruth.id, benjamin.id].includes(a.userId),
      );
    });

    await fill({ questionnaireId: target.id, userIds: [ruth.id, benjamin.id], deadline: DEADLINE });
    await submit();

    expect(saved).toEqual([
      { questionnaireTitle: 'Handling personal data', createdCount: 2, skipped: [] },
    ]);
    const created = mock.db.data.assignments.filter(
      (a) => a.questionnaireId === target.id && a.userId === ruth.id,
    );
    expect(created.map((a) => a.dueAt)).toEqual([endOfDay(DEADLINE)]);
  });

  it('assigns a department and names the employees who were skipped', async () => {
    const { fill, submit, saved, questionnaire, mock } = await render();
    const target = questionnaire('Handling personal data');
    const engineering = mock.db.data.departments.find((d) => d.name === 'Engineering')!;
    const amelia = mock.db.data.users.find((u) => u.firstName === 'Amelia')!;
    // Give Amelia an open assignment for it, so she is skipped.
    mock.db.update((data) => {
      data.assignments.push({
        id: 'open-assignment',
        organizationId: data.organization.id,
        questionnaireId: target.id,
        userId: amelia.id,
        assignedById: data.users[0].id,
        dueAt: new Date(2030, 0, 1).toISOString(),
        createdAt: new Date(2026, 10, 1).toISOString(),
        updatedAt: new Date(2026, 10, 1).toISOString(),
      });
    });

    await fill({
      questionnaireId: target.id,
      target: 'department',
      departmentId: engineering.id,
      deadline: DEADLINE,
    });
    await submit();

    expect(saved).toHaveLength(1);
    expect(saved[0].skipped).toContainEqual({
      userId: amelia.id,
      name: 'Amelia Hughes',
      reason: 'open_assignment',
    });
  });

  it('shows why the save failed when the API names no field', async () => {
    const { fill, submit, drawerText, user, questionnaire, saved } = await render(null, {
      flags: { errorStatus: 500, scope: '/assignments' },
    });
    await fill({
      questionnaireId: questionnaire('Handling personal data').id,
      userIds: [user('Ruth').id],
      deadline: DEADLINE,
    });

    await submit();

    expect(drawerText()).toContain('Could not assign the training');
    expect(drawerText()).toContain('Something went wrong. Try again in a moment.');
    expect(saved).toEqual([]);
  });

  it('puts a refused employee on the Employees field', async () => {
    const { fill, submit, drawerText, user, questionnaire, mock } = await render();
    const ruth = user('Ruth');
    await fill({
      questionnaireId: questionnaire('Handling personal data').id,
      userIds: [ruth.id],
      deadline: DEADLINE,
    });
    // Deactivated after the drawer loaded its options.
    mock.db.update(() => (ruth.status = 'inactive'));

    await submit();

    expect(drawerText()).toContain('Choose an active employee.');
  });
});

describe('endOfDay', () => {
  it('is 23:59:59 of the day in the local time zone, as UTC', () => {
    expect(endOfDay(new Date(2030, 0, 15))).toBe(new Date(2030, 0, 15, 23, 59, 59).toISOString());
  });
});
