import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  UrlTree,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { safeReturnUrl, signedInGuard, signedOutGuard } from './auth.guards';
import { AuthService } from './auth.service';

describe('auth guards', () => {
  function setup(signedIn: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { hasValidSession: () => signedIn } },
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
  });
});
