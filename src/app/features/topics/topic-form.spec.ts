import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import { toTopic } from '../../../mocks/rules/topic-rules';
import type { Topic } from '../../core/api';
import { TopicForm } from './topic-form';
import { TOPIC_ICON_OPTIONS } from './topic-icons';

describe('Topic form', () => {
  async function render(name: string | null, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const record = mock.db.data.topics.find((t) => t.name === name);
    const fixture = TestBed.createComponent(TopicForm);
    if (record)
      fixture.componentRef.setInput('topic', toTopic(record, mock.db.data.questionnaires));
    const saved: Topic[] = [];
    let closed = 0;
    fixture.componentInstance.saved.subscribe((t) => saved.push(t));
    fixture.componentInstance.closed.subscribe(() => closed++);
    await fixture.whenStable();

    const field = (selector: string) =>
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`sd-drawer ${selector}`)!;
    const type = async (selector: string, value: string) => {
      field(selector).value = value;
      field(selector).dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const setIcon = async (icon: Topic['icon']) => {
      fixture.componentInstance['model'].update((m) => ({ ...m, icon }));
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-drawer button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() =>
        expect(
          document.querySelector('sd-drawer button[type=submit]')?.hasAttribute('disabled') ??
            false,
        ).toBe(false),
      );
      await vi.waitFor(() => expect(fixture.componentInstance['saving']()).toBe(false));
      await fixture.whenStable();
    };
    return { fixture, mock, record, saved, closed: () => closed, field, type, setIcon, submit };
  }

  it('starts with the topic being edited, and previews its icon', async () => {
    const { field } = await render('Phishing Awareness');

    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit topic');
    expect(field('input').value).toBe('Phishing Awareness');
    expect(field('textarea').value).toContain('Recognize fraudulent emails');
    expect(document.querySelector('sd-drawer .preview')?.textContent).toContain('Phishing (fish)');
  });

  it('offers only the curated security icons, by name', () => {
    expect(TOPIC_ICON_OPTIONS).toHaveLength(17);
    expect(TOPIC_ICON_OPTIONS[0]).toEqual({ value: 'fish', label: 'Phishing (fish)' });
  });

  it('removes the icon when it is cleared', async () => {
    const { setIcon, submit, saved, record, mock } = await render('Data Protection');

    await setIcon(null);
    expect(document.querySelector('sd-drawer .preview')).toBeNull();
    await submit();

    expect(saved).toEqual([expect.objectContaining({ id: record?.id, icon: null })]);
    expect(mock.db.data.topics.find((t) => t.id === record?.id)?.icon).toBeNull();
  });

  it('checks the length of the fields before sending', async () => {
    const { type, submit, saved } = await render(null);

    await type('input', 'x'.repeat(101));
    await type('textarea', 'x'.repeat(1001));
    await submit();

    const errors = [...document.querySelectorAll('sd-drawer sd-field')].map((f) => f.textContent);
    expect(errors[0]).toContain('Use 100 characters or fewer.');
    expect(errors[1]).toContain('Use 1000 characters or fewer.');
    expect(saved).toEqual([]);
  });

  it('shows a failure without a field in a callout, and stays open', async () => {
    const { type, submit, saved, closed } = await render(null, { flags: { errorStatus: 500 } });

    await type('input', 'Insider Threats');
    await type('textarea', 'Spot risky behavior.');
    await submit();

    expect(document.querySelector('sd-drawer sd-callout')?.textContent).toContain(
      'Something went wrong. Try again in a moment.',
    );
    expect(saved).toEqual([]);
    expect(closed()).toBe(0);
  });
});
