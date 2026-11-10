import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { toQuestionnaire } from '../../../mocks/rules/questionnaire-rules';
import { toTopic } from '../../../mocks/rules/topic-rules';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Questionnaire } from '../../core/api';
import { QuestionnaireForm } from './questionnaire-form';

describe('Questionnaire form', () => {
  async function render(title: string | null, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const record = mock.db.data.questionnaires.find((q) => q.title === title);
    const fixture = TestBed.createComponent(QuestionnaireForm);
    fixture.componentRef.setInput(
      'topics',
      mock.db.data.topics.map((t) => toTopic(t, mock.db.data.questionnaires)),
    );
    if (record)
      fixture.componentRef.setInput('questionnaire', toQuestionnaire(record, mock.db.data));
    const saved: Questionnaire[] = [];
    let closed = 0;
    fixture.componentInstance.saved.subscribe((q) => saved.push(q));
    fixture.componentInstance.closed.subscribe(() => closed++);
    await fixture.whenStable();

    const form = fixture.componentInstance as unknown as {
      model: { update(fn: (m: Record<string, unknown>) => Record<string, unknown>): void };
      saving(): boolean;
      topicOptions(): { label: string; disabled?: boolean; description?: string }[];
    };
    const inputs = () => [...document.querySelectorAll<HTMLInputElement>('sd-drawer input')];
    const fields = () =>
      [...document.querySelectorAll('sd-drawer sd-field')].map((f) =>
        f.textContent?.replace(/\s+/g, ' '),
      );
    const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      element.value = value;
      element.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const set = async (values: Record<string, unknown>) => {
      form.model.update((m) => ({ ...m, ...values }));
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-drawer button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() => expect(form.saving()).toBe(false));
      await fixture.whenStable();
    };
    const topicId = (name: string) => mock.db.data.topics.find((t) => t.name === name)!.id;
    return {
      fixture,
      mock,
      record,
      form,
      saved,
      closed: () => closed,
      inputs,
      fields,
      type,
      set,
      submit,
      topicId,
    };
  }

  it('starts a new questionnaire with a passing score of 80 and no time limit', async () => {
    await render(null);

    expect(document.querySelector('sd-drawer')?.textContent).toContain('New questionnaire');
    const [passingScore, timeLimit] = [
      ...document.querySelectorAll<HTMLInputElement>('sd-drawer input[type=number]'),
    ];
    expect(passingScore.value).toBe('80');
    expect(timeLimit.value).toBe('');
  });

  it('says near the passing score that attempts keep the score they started with', async () => {
    const { fields } = await render(null);

    expect(fields().find((f) => f?.includes('Passing score'))).toContain(
      'Each attempt keeps the passing score it started with, so changing it never changes earlier results.',
    );
  });

  it('offers active topics, and lists inactive ones disabled', async () => {
    const { form } = await render(null);

    const cleanDesk = form.topicOptions().find((o) => o.label === 'Clean Desk Policy');
    const phishing = form.topicOptions().find((o) => o.label === 'Phishing Awareness');
    expect(cleanDesk).toMatchObject({
      disabled: true,
      description: 'Inactive. Choose an active topic.',
    });
    expect(phishing?.disabled).toBeUndefined();
  });

  it('keeps the inactive topic a questionnaire is already in selectable', async () => {
    const mock = createTestMockApi();
    const cleanDesk = mock.db.data.topics.find((t) => t.name === 'Clean Desk Policy')!;
    const record = mock.db.data.questionnaires.find((q) => q.title === 'Handling personal data')!;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const fixture = TestBed.createComponent(QuestionnaireForm);
    fixture.componentRef.setInput(
      'topics',
      mock.db.data.topics.map((t) => toTopic(t, mock.db.data.questionnaires)),
    );
    fixture.componentRef.setInput('questionnaire', {
      ...toQuestionnaire(record, mock.db.data),
      topicId: cleanDesk.id,
    });
    await fixture.whenStable();

    const options = (
      fixture.componentInstance as unknown as {
        topicOptions(): { label: string; disabled: boolean }[];
      }
    ).topicOptions();
    expect(options.find((o) => o.label === 'Clean Desk Policy')?.disabled).toBe(false);
  });

  it('checks the fields before sending, including passing score bounds', async () => {
    const { mock, inputs, type, fields, submit, set } = await render(null);
    const count = mock.db.data.questionnaires.length;

    await type(inputs()[0], '   ');
    await set({ passingScore: 101, timeLimitMinutes: 0 });
    await submit();

    const shown = fields();
    expect(shown[0]).toContain('Enter a title.');
    expect(shown.find((f) => f?.includes('Topic'))).toContain('Choose a topic.');
    expect(shown.find((f) => f?.includes('Passing score'))).toContain(
      'Enter a whole number from 1 to 100.',
    );
    expect(shown.find((f) => f?.includes('Time limit'))).toContain(
      'Enter a whole number from 1 to 480.',
    );
    await set({ passingScore: 0 });
    expect(fields().find((f) => f?.includes('Passing score'))).toContain(
      'Enter a whole number from 1 to 100.',
    );
    await set({ passingScore: null });
    expect(fields().find((f) => f?.includes('Passing score'))).toContain(
      'Enter a whole number from 1 to 100.',
    );
    expect(mock.db.data.questionnaires).toHaveLength(count);
  });

  it('trims the title before checking its length, like the API', async () => {
    const { inputs, type, set, submit, saved, topicId } = await render(null);

    await type(inputs()[0], `  ${'x'.repeat(200)}  `);
    await set({ topicId: topicId('Data Protection') });
    await submit();

    expect(saved.map((q) => q.title)).toEqual(['x'.repeat(200)]);
  });

  it('closes without a request when an edit changes nothing', async () => {
    const { mock, inputs, type, submit, saved, closed, record } =
      await render('Handling personal data');
    const logSize = mock.db.data.auditLog.length;

    // Spaces around the title are not a change.
    await type(inputs()[0], ` ${record!.title} `);
    await submit();

    expect(saved).toEqual([]);
    expect(mock.db.data.auditLog).toHaveLength(logSize);
    await vi.waitFor(() => expect(closed()).toBe(1));
  });

  it('sends only the changed settings in an edit, without a new version', async () => {
    const { mock, set, submit, saved, record } = await render('Handling personal data');
    const { currentVersionId } = record!;

    await set({ passingScore: 85, timeLimitMinutes: null });
    await submit();

    expect(saved).toEqual([
      expect.objectContaining({ passingScore: 85, timeLimitMinutes: null, currentVersionId }),
    ]);
    expect(mock.db.data.auditLog.at(-1)?.changes).toEqual([
      { field: 'passingScore', oldValue: 90, newValue: 85 },
      { field: 'timeLimitMinutes', oldValue: 15, newValue: null },
    ]);
  });

  it('shows an inactive topic error from the API on the topic field', async () => {
    const { set, inputs, type, submit, fields, saved, topicId } = await render(null);

    await type(inputs()[0], 'Clear desks');
    // The picker disables inactive topics; the API still checks.
    await set({ topicId: topicId('Clean Desk Policy') });
    await submit();

    expect(saved).toEqual([]);
    expect(fields().find((f) => f?.includes('Topic'))).toContain(
      'This topic is inactive. Choose an active topic.',
    );
  });

  it('shows a failure without a field in a callout, and stays open', async () => {
    const { inputs, type, set, submit, saved, closed, topicId } = await render(null, {
      flags: { errorStatus: 500 },
    });

    await type(inputs()[0], 'USB sticks');
    await set({ topicId: topicId('Device Security') });
    await submit();

    expect(saved).toEqual([]);
    expect(closed()).toBe(0);
    expect(document.querySelector('sd-drawer sd-callout[tone=danger]')?.textContent).toContain(
      'Could not save the questionnaire',
    );
  });
});
