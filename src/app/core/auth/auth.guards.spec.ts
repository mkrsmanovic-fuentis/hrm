import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  RedirectCommand,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import type { RoleKey } from '../api';
import { safeReturnUrl } from './auth-paths';
import { roleGuard, roleHomeRedirect, signedInGuard, signedOutGuard } from './auth.guards';
import { AuthService } from './auth.service';

describe('auth guards', () => {
  /** `true` signs in as an administrator; a role signs in with that role; `false` is signed out. */
  function setup(signedIn: boolean | RoleKey) {
    const role: RoleKey | null =
      signedIn === true ? 'administrator' : signedIn === false ? null : signedIn;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { hasValidSession: () => role !== null, role: () => role },
        },
      ],
    });
    return TestBed.inject(Router);
  }

  function run(guard: typeof signedInGuard, url: string) {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
  }

  describe('signedInGuard', () => {
    it('lets signed-in users through', () => {
      setup(true);

      expect(run(signedInGuard, '/topics')).toBe(true);
    });

    it('sends signed-out users to the login page, remembering where they were going', () => {
      const router = setup(false);

      const result = run(signedInGuard, '/topics?page=2');

      expect(result).toBeInstanceOf(UrlTree);
      expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Ftopics%3Fpage%3D2');
    });

    it('leaves out the return URL for the home page', () => {
      const router = setup(false);

      expect(router.serializeUrl(run(signedInGuard, '/') as UrlTree)).toBe('/login');
    });
  });

  describe('signedOutGuard', () => {
    it('lets signed-out users see the login page', () => {
      setup(false);

      expect(run(signedOutGuard, '/login')).toBe(true);
    });

    it('sends signed-in users to the home page', () => {
      const router = setup(true);

      expect(router.serializeUrl(run(signedOutGuard, '/login') as UrlTree)).toBe('/');
    });
  });

  describe('roleGuard', () => {
    it.each([
      ['administrator', '/admin/home'],
      ['employee', '/my/home'],
    ] as const)('lets the %s into their own area', (role, url) => {
      setup(role);

      expect(run(roleGuard(role), url)).toBe(true);
    });

    it.each([
      ['employee', 'administrator', '/admin/home'],
      ['administrator', 'employee', '/my/home'],
    ] as const)(
      'shows the no-access page to an %s opening the %s area, keeping the URL',
      (role, area, url) => {
        const router = setup(role);

        const result = run(roleGuard(area), url);

        expect(result).toBeInstanceOf(RedirectCommand);
        const command = result as RedirectCommand;
        expect(router.serializeUrl(command.redirectTo)).toBe('/no-access');
        expect(command.navigationBehaviorOptions?.browserUrl).toBe(url);
      },
    );

    it('sends signed-out users to the login page, remembering where they were going', () => {
      const router = setup(false);

      const result = run(roleGuard('administrator'), '/admin/home');

      expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Fadmin%2Fhome');
    });
  });

  describe('roleHomeRedirect', () => {
    function redirect() {
      return TestBed.runInInjectionContext(() =>
        roleHomeRedirect({} as Parameters<typeof roleHomeRedirect>[0]),
      );
    }

    it.each([
      ['administrator', '/admin/home'],
      ['employee', '/my/home'],
    ] as const)('sends the %s to their home page', (role, home) => {
      setup(role);

      expect(redirect()).toBe(home);
    });

    it('sends signed-out users to the login page', () => {
      setup(false);

      expect(redirect()).toBe('/login');
    });
  });

  describe('safeReturnUrl', () => {
    it.each([
      ['/topics?page=2', '/topics?page=2'],
      [null, '/'],
      ['', '/'],
      ['https://evil.example/', '/'],
      ['//evil.example/', '/'],
      ['/login?returnUrl=%2F', '/'],
    ])('turns %j into %j', (input, expected) => {
      expect(safeReturnUrl(input)).toBe(expected);
    });

    it.each([
      ['employee', '/admin/home', '/'],
      ['employee', '/admin?x=1', '/'],
      ['employee', '/my/home', '/my/home'],
      ['employee', '/administration', '/administration'],
      ['administrator', '/my/home#top', '/'],
      ['administrator', '/admin/home?page=2', '/admin/home?page=2'],
      ['administrator', '/no-access', '/no-access'],
    ] as const)(
      "for an %s, turns %j into %j, so another role's area leads home",
      (role, input, expected) => {
        expect(safeReturnUrl(input, role)).toBe(expected);
      },
    );
  });
});
