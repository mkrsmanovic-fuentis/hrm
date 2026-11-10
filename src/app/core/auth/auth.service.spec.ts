import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import { SESSION_LIFETIME_MS } from '../../../mocks/rules/auth-rules';
import { ApiError, ProblemType } from '../api';
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
        provideRouter([{ path: 'login', component: Blank }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    return { auth: TestBed.inject(AuthService), mock };
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
});
