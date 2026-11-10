import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  template: `
    <app-confirm-dialog
      [(open)]="open"
      heading="Deactivate department?"
      confirmLabel="Deactivate"
      tone="danger"
      [busy]="busy()"
      [error]="error()"
      (confirmed)="confirmed = confirmed + 1"
      (closed)="closed = closed + 1"
    >
      <p>Its history is kept.</p>
    </app-confirm-dialog>
  `,
})
class Host {
  readonly open = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  confirmed = 0;
  closed = 0;
}

describe('ConfirmDialog', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')].find(
        (b) => b.textContent?.trim() === text,
      )!;
    return { fixture, host: fixture.componentInstance, button };
  }

  it('shows the heading and message, and reports the confirmation', async () => {
    const { host, button } = await render();

    expect(document.querySelector('sd-dialog')?.textContent).toContain('Deactivate department?');
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Its history is kept.');
    button('Deactivate').click();

    expect(host.confirmed).toBe(1);
    expect(host.open()).toBe(true);
  });

  it('closes on Cancel', async () => {
    const { fixture, host, button } = await render();

    button('Cancel').click();
    await fixture.whenStable();

    expect(host.open()).toBe(false);
    expect(host.closed).toBe(1);
  });

  it('cannot be cancelled while busy, and shows an error', async () => {
    const { fixture, host, button } = await render();

    host.busy.set(true);
    host.error.set('Something went wrong.');
    await fixture.whenStable();

    expect(button('Cancel').disabled).toBe(true);
    expect(document.querySelector('sd-dialog sd-callout')?.textContent).toContain(
      'Something went wrong.',
    );
  });
});
