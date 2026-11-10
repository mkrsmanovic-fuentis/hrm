import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import { SESSION_LIFETIME_MS } from '../../../mocks/rules/auth-rules';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApiError, ProblemType } from '../api';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const ADMIN = 'maja.novak@brightwater.example';
const PASSWORD = 'demo-2026';

@Component({ template: '' })
class Blank {}

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
    // Sessions from the mock are relative to TEST_NOW, so the browser clock must agree.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi({ signedInAs: null, ...options });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Blank },
          { path: 'admin/home', component: Blank },
          { path: 'my/home', component: Blank },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    return { auth: TestBed.inject(AuthService), mock, router: TestBed.inject(Router) };
  }

  /** A fresh service reading the same storage, as after a page reload. */
  function reload(): AuthService {
    return TestBed.runInInjectionContext(() => new AuthService());
  }

  it('starts signed out', () => {
    const { auth } = setup();

    expect(auth.user()).toBeNull();
    expect(auth.role()).toBeNull();
    expect(auth.hasValidSession()).toBe(false);
  });

  it('signs in and exposes the user, role and token as signals', async () => {
    const { auth } = setup();

    await auth.signIn(ADMIN, PASSWORD);

    expect(auth.user()?.email).toBe(ADMIN);
    expect(auth.role()).toBe('administrator');
    expect(auth.token()).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.hasValidSession()).toBe(true);
  });

  it('keeps the session across a reload until it expires', async () => {
    const { auth } = setup();
    await auth.signIn(ADMIN, PASSWORD);

    expect(reload().user()?.email).toBe(ADMIN);

    vi.setSystemTime(TEST_NOW.getTime() + SESSION_LIFETIME_MS);
    expect(reload().user()).toBeNull();
    expect(localStorage.getItem('hrm.session')).toBeNull();
  });

  it('signs out locally once the session has expired', async () => {
    const { auth } = setup();
    await auth.signIn(ADMIN, PASSWORD);

    vi.setSystemTime(TEST_NOW.getTime() + SESSION_LIFETIME_MS - 1);
    expect(auth.hasValidSession()).toBe(true);
    vi.setSystemTime(TEST_NOW.getTime() + SESSION_LIFETIME_MS);
    expect(auth.hasValidSession()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('fails with invalid credentials for a wrong password and stays signed out', async () => {
    const { auth } = setup();

    const error = await auth.signIn(ADMIN, 'wrong').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.type).toBe(ProblemType.invalidCredentials);
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('hrm.session')).toBeNull();
  });

  it('ends the session on the server when signing out', async () => {
    const { auth, mock } = setup();
    await auth.signIn(ADMIN, PASSWORD);
    expect(mock.db.data.sessions).toHaveLength(1);

    await auth.signOut();

    expect(mock.db.data.sessions).toEqual([]);
    expect(auth.user()).toBeNull();
    expect(reload().user()).toBeNull();
  });

  it('signs out locally even when the sign-out call fails', async () => {
    const { auth } = setup();
    await auth.signIn(ADMIN, PASSWORD);
    TestBed.resetTestingModule();
    const failing = setup({ flags: { errorStatus: 500 } }).auth;

    await failing.signOut();

    expect(failing.user()).toBeNull();
  });

  it('switches between the demo administrator and employee', async () => {
    const { auth, mock } = setup();
    await auth.signInAsDemo('administrator');

    await auth.switchDemoRole('employee');

    expect(auth.role()).toBe('employee');
    expect(auth.user()?.email).toBe('amelia.hughes@brightwater.example');
    expect(mock.db.data.sessions).toHaveLength(1);
  });

  it('signs out when the API no longer knows the stored session', async () => {
    const { auth, mock } = setup();
    await auth.signIn(ADMIN, PASSWORD);
    mock.db.update((data) => {
      data.sessions = [];
    });

    await auth.refresh();

    expect(auth.user()).toBeNull();
  });

  describe('when the session expires on an open page', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(TEST_NOW);
    });

    it('signs out and opens the login page, which returns to the current page', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');

      await vi.advanceTimersByTimeAsync(SESSION_LIFETIME_MS - 1);
      expect(auth.user()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(auth.user()).toBeNull();
      expect(localStorage.getItem('hrm.session')).toBeNull();
      expect(router.url).toBe('/login?returnUrl=%2Fadmin%2Fhome');
    });

    it('also expires a session restored after a reload', async () => {
      const { auth } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await vi.advanceTimersByTimeAsync(SESSION_LIFETIME_MS / 2);

      const reloaded = reload();
      await vi.advanceTimersByTimeAsync(SESSION_LIFETIME_MS / 2);

      expect(reloaded.user()).toBeNull();
    });

    it('stops the timer on sign-out', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');

      await auth.signOut();
      await vi.advanceTimersByTimeAsync(SESSION_LIFETIME_MS);

      // Signing out navigates in the shell, not here; a leftover timer would open /login.
      expect(router.url).toBe('/admin/home');
    });
  });

  describe('across browser tabs', () => {
    /** What the browser does in this tab when another tab changes localStorage. */
    function otherTabWrites(value: string | null) {
      if (value === null) localStorage.removeItem('hrm.session');
      else localStorage.setItem('hrm.session', value);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'hrm.session',
          newValue: value,
          storageArea: localStorage,
        }),
      );
    }

    it('signs out here when another tab signs out', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');

      otherTabWrites(null);

      expect(auth.user()).toBeNull();
      await vi.waitFor(() => expect(router.url).toBe('/login?returnUrl=%2Fadmin%2Fhome'));
    });

    it('takes over a new session from another tab and opens its home', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');
      const employee = await setupOtherTabSession('amelia.hughes@brightwater.example');
      const navigate = vi.spyOn(router, 'navigateByUrl');

      otherTabWrites(JSON.stringify(employee));

      expect(auth.role()).toBe('employee');
      expect(auth.token()).toBe(employee.token);
      // `/` redirects to the home page of the new role.
      expect(navigate).toHaveBeenCalledWith('/', { onSameUrlNavigation: 'reload' });
    });

    it('stays on a page the new role may open, checking it again', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');
      const otherAdmin = await setupOtherTabSession('daniel.brooks@brightwater.example');
      const navigate = vi.spyOn(router, 'navigateByUrl');

      otherTabWrites(JSON.stringify(otherAdmin));

      expect(auth.user()?.email).toBe('daniel.brooks@brightwater.example');
      expect(navigate).toHaveBeenCalledWith('/admin/home', { onSameUrlNavigation: 'reload' });
    });

    it.each([
      ['keeps the return URL', '/login?returnUrl=%2Fmy%2Fhome%3Fpage%3D2', '/my/home?page=2'],
      ["goes home instead of another role's area", '/login?returnUrl=%2Fadmin%2Fhome', '/'],
      ['goes home without a return URL', '/login', '/'],
    ])('on the login page, when another tab signs in, %s', async (_, loginUrl, expected) => {
      const { auth, router } = setup();
      await router.navigateByUrl(loginUrl);
      const employee = await setupOtherTabSession('amelia.hughes@brightwater.example');
      const navigate = vi.spyOn(router, 'navigateByUrl');

      otherTabWrites(JSON.stringify(employee));

      expect(auth.role()).toBe('employee');
      expect(navigate).toHaveBeenCalledWith(expected, { onSameUrlNavigation: 'reload' });
    });

    it('ignores other keys and unchanged sessions', async () => {
      const { auth, router } = setup();
      await auth.signIn(ADMIN, PASSWORD);
      await router.navigateByUrl('/admin/home');
      const navigate = vi.spyOn(router, 'navigateByUrl');

      window.dispatchEvent(new StorageEvent('storage', { key: 'hrm.mockApi.db', newValue: '{}' }));
      otherTabWrites(localStorage.getItem('hrm.session'));

      expect(auth.user()?.email).toBe(ADMIN);
      expect(navigate).not.toHaveBeenCalled();
    });

    /** A session as another tab would store it, without touching this tab's state. */
    async function setupOtherTabSession(email: string) {
      return firstValueFrom(
        TestBed.inject(ApiClient).post('/auth/session', { body: { email, password: PASSWORD } }),
      );
    }
  });
});
