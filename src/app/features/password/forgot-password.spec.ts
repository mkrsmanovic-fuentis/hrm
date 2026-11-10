import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import { authInterceptor, DEMO_ACCOUNTS } from '../../core/auth';
import { ForgotPassword } from './forgot-password';

describe('Forgot password page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  async function render(options: TestMockApiOptions = {}, { demo = true } = {}) {
    const mock = createTestMockApi({ signedInAs: null, ...options });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
        ...(demo ? [] : [{ provide: DEMO_ACCOUNTS, useValue: null }]),
      ],
    });
    const fixture = TestBed.createComponent(ForgotPassword);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const send = async (email: string) => {
      const input = element.querySelector<HTMLInputElement>('input[type=email]')!;
      input.value = email;
      input.dispatchEvent(new Event('input'));
      element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() =>
        expect(element.querySelector('button[type=submit]')?.hasAttribute('disabled')).not.toBe(
          true,
        ),
      );
      await fixture.whenStable();
    };
    return { mock, element, send, text: () => element.textContent ?? '' };
  }

  it('asks for the email, with a way back to sign in', async () => {
    const { element } = await render();

    expect(element.querySelector('h1')?.textContent).toBe('Forgot your password?');
    expect(element.querySelector('a[href="/login"]')?.textContent).toContain('Back to sign in');
  });

  it('confirms in neutral words and shows the demo-only reset link', async () => {
    const { mock, element, send, text } = await render();

    await send('amelia.hughes@brightwater.example');

    expect(element.querySelector('h1')?.textContent).toBe('Check your email');
    expect(text()).toContain('If amelia.hughes@brightwater.example belongs to an account');
    expect(text()).toContain('Demo only: reset link');
    expect(text()).toContain('Copy reset link');
    const link = element.querySelector<HTMLInputElement>('app-demo-link input')!.value;
    expect(link).toContain('/reset-password?token=');
    const token = new URL(link).searchParams.get('token');
    expect(mock.db.data.accountLinks.map((l) => l.token)).toEqual([token]);
  });

  it('shows the same confirmation for an unknown email, without a link', async () => {
    const { element, send, text } = await render();

    await send('nobody@brightwater.example');

    expect(element.querySelector('h1')?.textContent).toBe('Check your email');
    expect(text()).toContain('If nobody@brightwater.example belongs to an account');
    expect(element.querySelector('app-demo-link')).toBeNull();
  });

  it('shows no link when the demo is off', async () => {
    const { element, send } = await render({}, { demo: false });

    await send('amelia.hughes@brightwater.example');

    expect(element.querySelector('h1')?.textContent).toBe('Check your email');
    expect(element.querySelector('app-demo-link')).toBeNull();
  });

  it('checks the email before sending', async () => {
    const { mock, send, text } = await render();

    await send('amelia');

    expect(text()).toContain('Enter a valid email address.');
    expect(mock.db.data.accountLinks).toEqual([]);
  });

  it('says when the request fails', async () => {
    const { send, text } = await render({ flags: { errorStatus: 500 } });

    await send('amelia.hughes@brightwater.example');

    expect(text()).toContain('Could not send the link');
  });
});
