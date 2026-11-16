import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { createTestMockApi, TEST_NOW } from '../../../mocks/testing';
import { toAssignment } from '../../../mocks/rules/training-rules';
import type { Assignment, AssignmentStatus } from '../../core/api';
import { endOfDay } from '../../shared/assign-training/deadline';
import { ChangeDeadlineDialog } from './change-deadline-dialog';

describe('Change deadline dialog', () => {
  /** A day well after both the test clock and the real one. */
  const NEW_DAY = new Date(2030, 0, 15);

  async function render(pick: (a: Assignment) => boolean) {
    const mock = createTestMockApi();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const assignment = mock.db.data.assignments
      .map((a) => toAssignment(a, mock.db.data, TEST_NOW))
      .find(pick);
    if (!assignment) throw new Error('No matching assignment in the seed');

    const fixture = TestBed.createComponent(ChangeDeadlineDialog);
    fixture.componentRef.setInput('assignment', assignment);
    const saved: Assignment[] = [];
    fixture.componentInstance.saved.subscribe((a) => saved.push(a));
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      saving: () => boolean;
      model: { set: (m: { deadline: Date | null }) => void; (): { deadline: Date | null } };
    };
    const dialogText = () => document.querySelector('sd-dialog')?.textContent ?? '';
    const pickDay = async (deadline: Date | null) => {
      component.model.set({ deadline });
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-dialog button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() => expect(component.saving()).toBe(false));
      await fixture.whenStable();
    };
    return { fixture, mock, assignment, component, saved, dialogText, pickDay, submit };
  }

  const withStatus = (status: AssignmentStatus) => (a: Assignment) => a.status === status;

  it('names the assignment and its current deadline, and starts empty when it is overdue', async () => {
    const { assignment, component, dialogText } = await render(withStatus('overdue'));

    expect(dialogText()).toContain('Change deadline');
    expect(dialogText()).toContain(assignment.questionnaireTitle);
    expect(dialogText()).toContain(assignment.employeeName);
    expect(component.model().deadline).toBeNull();
  });

  it('needs a day', async () => {
    const { saved, submit, dialogText } = await render(withStatus('overdue'));

    await submit();

    expect(dialogText()).toContain('Choose a deadline.');
    expect(saved).toEqual([]);
  });

  it('saves the end of the picked day and emits the updated assignment', async () => {
    const { mock, assignment, saved, pickDay, submit } = await render(withStatus('overdue'));

    await pickDay(NEW_DAY);
    await submit();

    expect(saved).toHaveLength(1);
    expect(saved[0].dueAt).toBe(endOfDay(NEW_DAY));
    expect(saved[0].status).not.toBe('overdue');
    expect(mock.db.data.assignments.find((a) => a.id === assignment.id)?.dueAt).toBe(
      endOfDay(NEW_DAY),
    );
  });

  it('shows why the save failed when the assignment is passed', async () => {
    const { saved, pickDay, submit, dialogText } = await render(withStatus('passed'));

    await pickDay(NEW_DAY);
    await submit();

    expect(saved).toEqual([]);
    expect(dialogText()).toContain('Could not change the deadline');
    expect(dialogText()).toContain('This assignment is passed.');
  });
});
