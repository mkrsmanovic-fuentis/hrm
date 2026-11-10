import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import { AuthService, authInterceptor } from '../../core/auth';
import { Login } from './login';

@Component({ template: '<p>Signed-in page</p>' })
class SignedInPage {}

describe('Login page', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  async function render(url = '/login', options: TestMockApiOptions = {}) {
    const mock = createTestMockApi({ signedInAs: null, ...options });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Login },
          { path: '**', component: SignedInPage },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const type = (selector: string, value: string) => {
      const input = element.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const settle = async () => {
      await fixture.whenStable();
      await vi.waitFor(() =>
        expect(element.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(false),
      );
      await fixture.whenStable();
    };
    return {
      element,
      router,
      auth: TestBed.inject(AuthService),
      fill: (email: string, password: string) => {
        type('input[type=email]', email);
        type('sd-password input', password);
      },
      submit: async () => {
        element.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
        await settle();
      },
      clickButton: async (text: string) => {
        const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === text,
        );
        if (!button) throw new Error(`No button "${text}"`);
        button.click();
        await settle();
      },
    };
  }

  it('shows email and password fields and a sign-in button', async () => {
    const { element } = await render();

    const labels = [...element.querySelectorAll('sd-field label')].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels.join(' ')).toContain('Email');
    expect(labels.join(' ')).toContain('Password');
    expect(element.querySelector('button[type=submit]')?.textContent?.trim()).toBe('Sign in');
  });

  it('links to the forgot password page', async () => {
    const { element } = await render();

    const link = element.querySelector<HTMLAnchorElement>('a[href="/forgot-password"]');
    expect(link?.textContent?.trim()).toBe('Forgot password?');
  });

  it('asks for both fields before calling the API', async () => {
    const { element, submit, auth } = await render();

    await submit();

    expect(element.textContent).toContain('Enter your email.');
    expect(element.textContent).toContain('Enter your password.');
    expect(auth.user()).toBeNull();
  });

  it('signs in and opens the page the user was going to', async () => {
    const { fill, submit, auth, router } = await render('/login?returnUrl=%2Ftopics');

    fill('maja.novak@brightwater.example', 'demo-2026');
    await submit();

    expect(auth.role()).toBe('administrator');
    expect(router.url).toBe('/topics');
  });

  it("opens the user's own home instead of a page in another role's area", async () => {
    const { fill, submit, auth, router } = await render('/login?returnUrl=%2Fadmin%2Fhome');

    fill('amelia.hughes@brightwater.example', 'demo-2026');
    await submit();

    expect(auth.role()).toBe('employee');
    // `/` redirects to the employee's home in the app's routes.
    expect(router.url).toBe('/');
  });

  it('shows an error for a wrong password and stays on the login page', async () => {
    const { element, fill, submit, auth, router } = await render();

    fill('maja.novak@brightwater.example', 'not-the-password');
    await submit();

    const alert = element.querySelector('sd-callout[role=alert]');
    expect(alert?.textContent).toContain('Wrong email or password');
    expect(auth.user()).toBeNull();
    expect(router.url).toBe('/login');
  });

  it('explains when the account is deactivated', async () => {
    const { element, fill, submit } = await render();

    fill('sofia.lindqvist@brightwater.example', 'demo-2026');
    await submit();

    expect(element.querySelector('sd-callout[role=alert]')?.textContent).toContain(
      'Account deactivated',
    );
  });

  it('signs in with one click as the demo employee', async () => {
    const { element, clickButton, auth, router } = await render();

    expect(element.textContent).toContain('Demo accounts');
    await clickButton('Sign in as Employee');

    expect(auth.role()).toBe('employee');
    expect(router.url).toBe('/');
  });
});
