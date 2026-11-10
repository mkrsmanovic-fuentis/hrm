import { TestBed } from '@angular/core/testing';
import { DemoLink } from './demo-link';

const LINK = 'http://localhost:4200/set-password?token=abc';

describe('DemoLink', () => {
  afterEach(() => vi.restoreAllMocks());

  async function render(closable = false) {
    const fixture = TestBed.createComponent(DemoLink);
    fixture.componentRef.setInput('heading', 'Demo only: invite link');
    fixture.componentRef.setInput('copyLabel', 'Copy invite link');
    fixture.componentRef.setInput('link', LINK);
    fixture.componentRef.setInput('closable', closable);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (text: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      );
    return { fixture, element, button };
  }

  it('shows the heading and the link in a read-only field', async () => {
    const { element } = await render();

    expect(element.textContent).toContain('Demo only: invite link');
    const input = element.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe(LINK);
    expect(input.readOnly).toBe(true);
  });

  it('copies the link and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, button } = await render();

    button('Copy invite link')!.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith(LINK);
    await vi.waitFor(() => expect(button('Copied')).toBeDefined());
  });

  it('asks to copy by hand when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Blocked'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, element, button } = await render();

    button('Copy invite link')!.click();
    await fixture.whenStable();

    await vi.waitFor(() => expect(element.textContent).toContain('Select the link and copy it.'));
  });

  it('closes only when closable', async () => {
    expect((await render()).button('Close')).toBeUndefined();

    TestBed.resetTestingModule();
    const { fixture, button } = await render(true);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    button('Close')!.click();

    expect(closed).toHaveBeenCalled();
  });
});
