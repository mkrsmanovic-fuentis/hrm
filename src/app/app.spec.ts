import { Location } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../mocks/testing';
import { App } from './app';
import { navigation } from './app.navigation';
import { routes } from './app.routes';
import { AuthService, authInterceptor } from './core/auth';
import { provideNavigation } from './core/navigation';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  async function renderAt(
    url: string,
    signInAs: 'administrator' | 'employee' | null,
    mockOptions: TestMockApiOptions = {},
  ) {
    const mock = createTestMockApi({ signedInAs: null, ...mockOptions });
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideNavigation(navigation),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    const auth = TestBed.inject(AuthService);
    if (signInAs) await auth.signInAsDemo(signInAs);
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const element = fixture.nativeElement as HTMLElement;
    await router.navigateByUrl(url);
    await fixture.whenStable();
    await vi.waitFor(() => expect(element.querySelector('sd-skeleton')).toBeNull());
    await fixture.whenStable();
    const clickMenuItem = async (text: string) => {
      const button = [...element.querySelectorAll<HTMLButtonElement>('sd-popover button')].find(
        (b) => b.textContent?.trim() === text,
      );
      if (!button) throw new Error(`No menu item "${text}"`);
      button.click();
      await vi.waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
      await fixture.whenStable();
    };
    const navLinks = () =>
      [...element.querySelectorAll<HTMLAnchorElement>('sd-sidenav a')].map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]);
    return { element, router, auth, mock, clickMenuItem, navLinks };
  }

  it('sends signed-out users to the login page', async () => {
    const { element, router } = await renderAt('/', null);

    expect(router.url).toBe('/login');
    expect(element.querySelector('app-login')).not.toBeNull();
    expect(element.querySelector('sd-topbar')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Sign in · HRM Platform');
  });

  it('keeps signed-in users off the login page', async () => {
    const { router } = await renderAt('/login', 'administrator');

    expect(router.url).toBe('/admin/home');
  });

  it.each([
    ['administrator', '/admin/home'],
    ['employee', '/my/home'],
  ] as const)('opens the %s home page for /', async (role, home) => {
    const { router, element } = await renderAt('/', role);

    expect(router.url).toBe(home);
    expect(element.querySelector('main app-home')).not.toBeNull();
  });

  it('shows the signed-in user and role in the top bar, with the home page below', async () => {
    const { element } = await renderAt('/', 'administrator');

    const topbar = element.querySelector('sd-topbar');
    expect(topbar?.querySelector('a[sdTopbarStart]')?.getAttribute('href')).toBe('/');
    expect(topbar?.querySelector('[sdTopbarEnd] button')?.textContent?.trim()).toBe('Maja Novak');
    expect(topbar?.querySelector('sd-badge')?.textContent?.trim()).toBe('Administrator');
    const header = element.querySelector('main app-home sd-status-bar')?.textContent;
    expect(header).toContain('Home');
    expect(header).toContain('Brightwater Logistics');
    expect(TestBed.inject(Title).getTitle()).toBe('Home · HRM Platform');
  });

  it.each([
    ['administrator', '/admin/home'],
    ['employee', '/my/home'],
  ] as const)('shows the %s only their own navigation entries', async (role, home) => {
    const { navLinks } = await renderAt('/', role);

    expect(navLinks()).toEqual([['Home', home]]);
  });

  it.each([
    ['employee', '/admin/home'],
    ['administrator', '/my/home'],
  ] as const)(
    'shows the no-access page to an %s opening %s, keeping the URL and the session',
    async (role, url) => {
      const { element, auth } = await renderAt(url, role);

      expect(TestBed.inject(Location).path()).toBe(url);
      expect(element.querySelector('main app-home')).toBeNull();
      const page = element.querySelector('main app-no-access');
      expect(page?.querySelector('h1')?.textContent?.trim()).toBe('No access');
      expect(page?.textContent).toContain("Your role doesn't have access to this page.");
      expect(page?.querySelector('a[sd-button]')?.getAttribute('href')).toBe('/');
      expect(TestBed.inject(Title).getTitle()).toBe('No access · HRM Platform');
      expect(auth.role()).toBe(role);
      expect(element.querySelector('sd-topbar')).not.toBeNull();
    },
  );

  it('shows the no-access state when the API answers 403, and stays signed in', async () => {
    const { element, auth, router } = await renderAt('/', 'employee', {
      flags: { errorStatus: 403, scope: '/organization' },
    });

    expect(router.url).toBe('/my/home');
    const state = element.querySelector('main app-home app-access-denied');
    expect(state?.querySelector('h2')?.textContent?.trim()).toBe('No access');
    expect(state?.textContent).toContain("You don't have permission to see your organization.");
    expect(auth.user()).not.toBeNull();
  });

  it('redirects unknown URLs to the home page', async () => {
    const { router, element } = await renderAt('/does-not-exist', 'employee');

    expect(router.url).toBe('/my/home');
    expect(element.querySelector('app-home')).not.toBeNull();
  });

  it('signs out from the user menu', async () => {
    const { element, router, auth, mock, clickMenuItem } = await renderAt('/', 'employee');

    await clickMenuItem('Sign out');

    expect(auth.user()).toBeNull();
    expect(mock.db.data.sessions).toEqual([]);
    expect(router.url).toBe('/login');
    expect(element.querySelector('app-login')).not.toBeNull();
  });

  it('switches between the demo administrator and employee from the user menu', async () => {
    const { element, auth, clickMenuItem } = await renderAt('/', 'administrator');

    await clickMenuItem('Switch to employee');
    expect(auth.role()).toBe('employee');
    expect(element.querySelector('sd-topbar sd-badge')?.textContent?.trim()).toBe('Employee');

    await clickMenuItem('Switch to administrator');
    expect(auth.role()).toBe('administrator');
  });
});
