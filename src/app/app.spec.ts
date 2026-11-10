import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { createTestMockApi, TEST_NOW } from '../mocks/testing';
import { App } from './app';
import { routes } from './app.routes';
import { AuthService, authInterceptor } from './core/auth';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TEST_NOW);
  });

  afterEach(() => vi.useRealTimers());

  async function renderAt(url: string, signInAs: 'administrator' | 'employee' | null) {
    const mock = createTestMockApi({ signedInAs: null });
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        ...mock.providers,
      ],
    });
    const auth = TestBed.inject(AuthService);
    if (signInAs) await auth.signInAsDemo(signInAs);
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const clickMenuItem = async (text: string) => {
      const button = [...element.querySelectorAll<HTMLButtonElement>('sd-popover button')].find(
        (b) => b.textContent?.trim() === text,
      );
      if (!button) throw new Error(`No menu item "${text}"`);
      button.click();
      await vi.waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
      await fixture.whenStable();
    };
    return { element, router, auth, mock, clickMenuItem };
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

    expect(router.url).toBe('/');
  });

  it('shows the signed-in user and role in the top bar, with the home page below', async () => {
    const { element } = await renderAt('/', 'administrator');

    const topbar = element.querySelector('sd-topbar');
    expect(topbar?.querySelector('a[sdTopbarStart]')?.getAttribute('href')).toBe('/');
    expect(topbar?.querySelector('[sdTopbarEnd] button')?.textContent?.trim()).toBe('Maja Novak');
    expect(topbar?.querySelector('sd-badge')?.textContent?.trim()).toBe('Administrator');
    expect(element.querySelector('main app-home sd-status-bar')?.textContent).toContain('Home');
    expect(TestBed.inject(Title).getTitle()).toBe('HRM Platform');
  });

  it('redirects unknown URLs to the home page', async () => {
    const { router, element } = await renderAt('/does-not-exist', 'employee');

    expect(router.url).toBe('/');
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
