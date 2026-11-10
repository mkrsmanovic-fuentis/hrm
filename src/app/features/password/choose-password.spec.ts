import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DEMO_PASSWORD } from '../../../mocks/seed/people.seed';
import { createTestMockApi, TEST_NOW } from '../../../mocks/testing';
import type { SimulationFlags } from '../../../mocks/support/simulation';
import { AuthService, authInterceptor } from '../../core/auth';
import { ToastService } from '../../core/toast';
import { ChoosePassword } from './choose-password';

@Component({ template: '<p>Home page</p>' })
class HomePage {}

const HOUR = 60 * 60 * 1000;
const NEW_PASSWORD = 'a long new password';

describe('Set and reset password pages', () => {
  let flags: SimulationFlags;

  beforeEach(() => {
    localStorage.clear();
    flags = {};
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  async function setup() {
    const mock = createTestMockApi({ signedInAs: 'administrator', flags: () => flags });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'set-password', component: ChoosePassword, data: { purpose: 'invitation' } },
          {
            path: 'reset-password',
            component: ChoosePassword,
            data: { purpose: 'password_reset' },
          },
          { path: '**', component: HomePage },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    const harness = await RouterTestingHarness.create();
    return { mock, harness };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  /** Creates a user as the administrator and returns the token of their invite link. */
  async function invite({ mock }: Setup): Promise<string> {
    const response = await mock.fetch('/api/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'hana.sato@brightwater.example',
        firstName: 'Hana',
        lastName: 'Sato',
        role: 'employee',
      }),
    });
    return new URL(response.headers.get('X-Demo-Link')!).searchParams.get('token')!;
  }

  async function resetLink({ mock }: Setup, email: string): Promise<string> {
    const response = await mock.fetch('/api/v1/auth/password-resets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return new URL(response.headers.get('X-Demo-Link')!).searchParams.get('token')!;
  }

  async function open({ harness }: Setup, url: string) {
    await harness.navigateByUrl(url);
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(element().querySelector('[aria-busy="true"]')).toBeNull();
    });
    await harness.fixture.whenStable();
  }

  const element = () => document.body;
  const text = () => element().textContent ?? '';

  function type(label: string, value: string) {
    const field = [...element().querySelectorAll('sd-field')].find((f) =>
      f.querySelector('label')?.textContent?.includes(label),
    );
    const input = field?.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error(`No input for ${label}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function submit({ harness }: Setup) {
    element().querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await harness.fixture.whenStable();
    await vi.waitFor(() =>
      expect(
        element().querySelector('button[type=submit]')?.hasAttribute('disabled') ?? false,
      ).toBe(false),
    );
    await harness.fixture.whenStable();
  }

  describe('set your password', () => {
    it('greets the user, sets the password, signs them in and opens their home page', async () => {
      const page = await setup();
      const token = await invite(page);
      await open(page, `/set-password?token=${token}`);

      expect(element().querySelector('h1')?.textContent).toBe('Set your password');
      expect(text()).toContain('Hi Hana.');
      expect(text()).toContain('hana.sato@brightwater.example');

      type('New password', NEW_PASSWORD);
      type('Confirm password', NEW_PASSWORD);
      await submit(page);

      const auth = TestBed.inject(AuthService);
      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
      expect(auth.user()).toMatchObject({ firstName: 'Hana', role: 'employee' });
      expect(TestBed.inject(ToastService).toasts()).toEqual([
        expect.objectContaining({ heading: 'Password set' }),
      ]);
    });

    it('checks the password rules and the confirmation before sending', async () => {
      const page = await setup();
      const token = await invite(page);
      await open(page, `/set-password?token=${token}`);

      type('New password', 'too short');
      type('Confirm password', 'something else');
      await submit(page);

      expect(text()).toContain('Use at least 12 characters.');
      expect(text()).toContain('The passwords do not match.');

      type('New password', 'hana.sato@brightwater.example');
      type('Confirm password', 'hana.sato@brightwater.example');
      await submit(page);

      expect(text()).toContain('Do not use your email address as your password.');
      expect(page.mock.db.data.credentials).toEqual([]);
      expect(TestBed.inject(Router).url).toContain('/set-password');
    });

    it('explains an expired invite link and what to do next', async () => {
      const page = await setup();
      const token = await invite(page);
      flags = { clockOffsetMs: 7 * 24 * HOUR, scope: '/auth' };

      await open(page, `/set-password?token=${token}`);

      expect(text()).toContain('This invite link has expired');
      expect(text()).toContain('Ask your administrator to send you a new invite.');
      expect(element().querySelector('form')).toBeNull();
      expect(element().querySelector('a[href="/login"]')).not.toBeNull();
    });

    it('explains an invite link that was used already', async () => {
      const page = await setup();
      const token = await invite(page);
      await page.mock.fetch(`/api/v1/auth/invitations/${token}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: NEW_PASSWORD }),
      });

      await open(page, `/set-password?token=${token}`);

      expect(text()).toContain('Your password is already set');
    });

    it.each([
      ['an unknown token', '/set-password?token=nope'],
      ['no token', '/set-password'],
    ])('explains a link with %s', async (_, url) => {
      const page = await setup();

      await open(page, url);

      expect(text()).toContain('This invite link is not valid');
    });

    it('explains a link that was replaced while the page was open', async () => {
      const page = await setup();
      const token = await invite(page);
      await open(page, `/set-password?token=${token}`);
      const hana = page.mock.db.data.users.find((u) => u.firstName === 'Hana')!;
      await page.mock.fetch(`/api/v1/users/${hana.id}/invitation`, { method: 'POST' });

      type('New password', NEW_PASSWORD);
      type('Confirm password', NEW_PASSWORD);
      await submit(page);

      await vi.waitFor(() => expect(text()).toContain('This invite link is not valid'));
      expect(TestBed.inject(AuthService).user()).toBeNull();
    });

    it('offers to try again when the link cannot be checked', async () => {
      const page = await setup();
      flags = { errorStatus: 500 };

      await open(page, '/set-password?token=abc');

      expect(text()).toContain('Could not check the link');
      flags = {};
    });
  });

  describe('reset your password', () => {
    const EMAIL = 'amelia.hughes@brightwater.example';

    it('sets the new password, signs in and ends the other sessions', async () => {
      const page = await setup();
      const amelia = page.mock.db.data.users.find((u) => u.email === EMAIL)!;
      await page.mock.fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer none' },
        body: JSON.stringify({ email: EMAIL, password: DEMO_PASSWORD }),
      });
      const token = await resetLink(page, EMAIL);
      await open(page, `/reset-password?token=${token}`);

      expect(element().querySelector('h1')?.textContent).toBe('Reset your password');
      type('New password', NEW_PASSWORD);
      type('Confirm password', NEW_PASSWORD);
      await submit(page);

      await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/'));
      const auth = TestBed.inject(AuthService);
      expect(auth.user()?.email).toBe(EMAIL);
      expect(page.mock.db.data.sessions.filter((s) => s.userId === amelia.id)).toEqual([
        expect.objectContaining({ token: auth.token() }),
      ]);
      expect(TestBed.inject(ToastService).toasts()[0].heading).toBe('Password changed');
    });

    it('explains an expired reset link and offers a new one', async () => {
      const page = await setup();
      const token = await resetLink(page, EMAIL);
      flags = { clockOffsetMs: HOUR, scope: '/auth/password-resets' };

      await open(page, `/reset-password?token=${token}`);

      expect(text()).toContain('This reset link has expired');
      expect(text()).toContain('Password reset links work for 1 hour.');
      expect(element().querySelector('a[href="/forgot-password"]')?.textContent).toContain(
        'Request a new link',
      );
    });

    it('explains a reset link that was used already', async () => {
      const page = await setup();
      const token = await resetLink(page, EMAIL);
      await page.mock.fetch(`/api/v1/auth/password-resets/${token}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: NEW_PASSWORD }),
      });

      await open(page, `/reset-password?token=${token}`);

      expect(text()).toContain('This reset link was used already');
    });
  });
});
