import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { LucideBookOpen, LucideFish } from '@lucide/angular';
import { SdList } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Topic } from '../../core/api';
import { ToastService } from '../../core/toast';
import { TopicList } from './topic-list';

describe('Topics page', () => {
  async function render(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), ...mock.providers],
    });
    const fixture = TestBed.createComponent(TopicList);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<Topic> | undefined;
    const click = async (text: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      );
      if (!button) throw new Error(`No button "${text}"`);
      button.click();
      await fixture.whenStable();
    };
    const type = async (selector: string, value: string) => {
      const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (!input) throw new Error(`No ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const settle = async () => {
      await fixture.whenStable();
      await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
      await fixture.whenStable();
    };
    const row = (name: string) => {
      const topic = list()
        ?.items()
        .find((t) => t.name === name);
      if (!topic) throw new Error(`No row ${name}`);
      return topic;
    };
    return {
      fixture,
      element,
      mock,
      list,
      click,
      type,
      settle,
      row,
      toasts: TestBed.inject(ToastService),
    };
  }

  it('lists every topic with its icon, description, questionnaire count and status', async () => {
    const { element, list, row, mock } = await render();

    expect(element.querySelector('sd-status-bar')?.textContent).toContain('Topics');
    expect(element.textContent).toContain('New topic');
    expect(list()?.items()).toHaveLength(mock.db.data.topics.length);
    const columns = list()?.columns() ?? [];
    expect(columns.map((c) => c.label)).toEqual([
      'Name',
      'Description',
      'Questionnaires',
      'Status',
    ]);
    const name = columns.find((c) => c.id === 'name');
    const count = columns.find((c) => c.id === 'questionnaireCount');
    const status = columns.find((c) => c.id === 'status');
    expect(name?.icon?.(row('Phishing Awareness'))).toBe(LucideFish);
    // A topic without an icon gets the generic one, so its name lines up with the others.
    expect(name?.icon?.({ ...row('Phishing Awareness'), icon: null })).toBe(LucideBookOpen);
    expect(count?.value(row('Clean Desk Policy'))).toBe(0);
    expect(status?.value(row('Clean Desk Policy'))).toBe('Inactive');
    expect(status?.value(row('Phishing Awareness'))).toBe('Active');
    expect(
      list()
        ?.filters()
        .map((f) => f.label),
    ).toEqual(['Status']);
    expect(list()?.searchable()).toBe(true);
  });

  it('shows the no-access state on 403, without the New topic button', async () => {
    const { element } = await render({ flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')?.textContent).toContain(
      "You don't have permission to manage topics.",
    );
    expect(element.textContent).not.toContain('New topic');
  });

  it('shows an error with a retry button when loading fails', async () => {
    const { element } = await render({ flags: { errorStatus: 500 } });

    expect(element.querySelector('sd-callout')?.textContent).toContain('Could not load topics');
    expect(element.textContent).toContain('Try again');
  });

  it('shows the empty state when there are no topics', async () => {
    const { element } = await render({ flags: { empty: true } });

    expect(element.textContent).toContain('No topics yet');
  });

  it('creates a topic with an icon and confirms it with a toast', async () => {
    const { fixture, element, click, type, settle, list, mock, toasts } = await render();

    await click('New topic');
    expect(document.querySelector('sd-drawer')?.textContent).toContain('New topic');
    await type('sd-drawer input', '  Mobile Security ');
    await type('sd-drawer textarea', 'Keep phones and tablets safe.');
    // sd-select has no native control; set the value the way the picker does.
    const form = fixture.debugElement.query(By.css('app-topic-form')).componentInstance;
    form['model'].update((m: object) => ({ ...m, icon: 'smartphone' }));
    await fixture.whenStable();
    expect(document.querySelector('sd-drawer .preview')?.textContent).toContain(
      'Mobile devices (phone)',
    );
    await click('Create topic');
    await settle();

    await vi.waitFor(() =>
      expect(
        list()
          ?.items()
          .map((t) => t.name),
      ).toContain('Mobile Security'),
    );
    expect(mock.db.data.topics.find((t) => t.name === 'Mobile Security')).toMatchObject({
      description: 'Keep phones and tablets safe.',
      icon: 'smartphone',
      status: 'active',
    });
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Topic created']);
    expect(element.querySelector('app-topic-form')).toBeNull();
  });

  it('shows a duplicate name on the name field and keeps the drawer open', async () => {
    const { click, type, settle, mock, toasts } = await render();

    await click('New topic');
    await type('sd-drawer input', ' phishing AWARENESS ');
    await type('sd-drawer textarea', 'Again.');
    await click('Create topic');
    await settle();

    await vi.waitFor(() =>
      expect(document.querySelector('sd-drawer sd-field')?.textContent).toContain(
        'A topic with this name already exists.',
      ),
    );
    expect(
      mock.db.data.topics.filter((t) => t.name.toLowerCase() === 'phishing awareness'),
    ).toHaveLength(1);
    expect(toasts.toasts()).toEqual([]);
  });

  it('checks the name and description before sending', async () => {
    const { click, type, mock } = await render();
    const count = mock.db.data.topics.length;

    await click('New topic');
    await type('sd-drawer input', '   ');
    await click('Create topic');

    const fields = [...document.querySelectorAll('sd-drawer sd-field')].map((f) => f.textContent);
    expect(fields[0]).toContain('Enter a name.');
    expect(fields[1]).toContain('Enter a description.');
    expect(mock.db.data.topics).toHaveLength(count);
  });

  it('edits a topic from its row', async () => {
    const { fixture, click, type, settle, list, row, mock, toasts } = await render();

    list()?.rowClick.emit(row('Device Security'));
    await fixture.whenStable();
    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit topic');
    expect(document.querySelector<HTMLInputElement>('sd-drawer input')?.value).toBe(
      'Device Security',
    );
    expect(document.querySelector('sd-drawer .preview')?.textContent).toContain(
      'Computers (laptop)',
    );
    await type('sd-drawer input', 'Device and Mobile Security');
    await click('Save changes');
    await settle();

    await vi.waitFor(() =>
      expect(
        list()
          ?.items()
          .map((t) => t.name),
      ).toContain('Device and Mobile Security'),
    );
    expect(mock.db.data.topics.find((t) => t.name === 'Device and Mobile Security')?.icon).toBe(
      'laptop',
    );
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Topic saved']);
  });

  it('deactivates a topic after a confirmation that says results stay accessible and assigning stops', async () => {
    const { fixture, click, settle, list, row, mock, toasts } = await render();
    const phishing = row('Phishing Awareness');

    list()?.actionClick.emit({ action: 'deactivate', row: phishing });
    await fixture.whenStable();
    const text = document.querySelector('sd-dialog')?.textContent?.replace(/\s+/g, ' ');
    expect(text).toContain('Deactivate topic?');
    expect(text).toContain(
      'Its questionnaires can no longer be assigned, but training already assigned on them can still be completed.',
    );
    expect(text).toContain(
      "Its history and its questionnaires' results are kept and stay accessible.",
    );
    await click('Deactivate');
    await settle();

    await vi.waitFor(() => expect(row('Phishing Awareness').status).toBe('inactive'));
    expect(mock.db.data.topics.find((t) => t.id === phishing.id)?.status).toBe('inactive');
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Topic deactivated']);
    expect(mock.db.data.auditLog.at(-1)).toMatchObject({
      action: 'deactivated',
      entityType: 'topic',
      entityId: phishing.id,
    });
  });

  it('reactivates an inactive topic', async () => {
    const { fixture, click, settle, list, row, toasts } = await render();

    list()?.actionClick.emit({ action: 'reactivate', row: row('Clean Desk Policy') });
    await fixture.whenStable();
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Reactivate topic?');
    await click('Reactivate');
    await settle();

    await vi.waitFor(() => expect(row('Clean Desk Policy').status).toBe('active'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Topic reactivated']);
  });

  it('offers deactivate only for active and reactivate only for inactive topics', async () => {
    const { list, row } = await render();
    const actions = list()?.actions() ?? [];
    const visible = (t: Topic) => actions.filter((a) => !a.hidden?.(t)).map((a) => a.id);

    expect(visible(row('Phishing Awareness'))).toEqual(['edit', 'deactivate']);
    expect(visible(row('Clean Desk Policy'))).toEqual(['edit', 'reactivate']);
  });
});
