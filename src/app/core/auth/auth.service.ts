import { DOCUMENT, Location } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment, type DemoAccount } from '../../../environments/environment';
import { ApiClient, type RoleKey, type Session } from '../api';
import {
  addressBarUrl,
  isLoginPage,
  LOGIN_PATH,
  returnUrlParams,
  safeReturnUrl,
} from './auth-paths';

/** Where the session is kept between page loads. Tests replace it. */
export const SESSION_STORAGE = new InjectionToken<Storage | null>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
});

/** Demo accounts offered on the login page and in the user menu, or null when there are none. */
export const DEMO_ACCOUNTS = new InjectionToken<{
  password: string;
  accounts: DemoAccount[];
} | null>('DEMO_ACCOUNTS', { providedIn: 'root', factory: () => environment.demo });

const STORAGE_KEY = 'hrm.session';

/** setTimeout cannot wait longer than this; longer waits are split. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The signed-in session. Signs in and out through the API, keeps the session in localStorage so
 * it survives a reload until it expires, and exposes the current user and role as signals.
 *
 * - When the session reaches `expiresAt`, a timer signs out and opens `/login`, even if the user
 *   is just looking at a page.
 * - Other tabs of the app share the session through localStorage: signing in, out or switching
 *   the demo role in one tab does the same in the others.
 *
 * The HTTP interceptor adds the token to API calls and calls {@link endSession} on `401`. The route
 * guards send signed-out users to `/login`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly storage = inject(SESSION_STORAGE);
  private readonly demo = inject(DEMO_ACCOUNTS);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  private readonly state = signal<Session | null>(this.restore());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.scheduleExpiry();

    const window = inject(DOCUMENT).defaultView;
    const onStorage = (event: StorageEvent) => this.syncFromOtherTab(event);
    window?.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => {
      window?.removeEventListener('storage', onStorage);
      this.cancelExpiry();
    });
  }

  /** The current session, or null when signed out. */
  readonly session = this.state.asReadonly();
  /** The signed-in user, or null when signed out. */
  readonly user = computed(() => this.state()?.user ?? null);
  /** The signed-in user's role, or null when signed out. */
  readonly role = computed<RoleKey | null>(() => this.user()?.role ?? null);
  /** The session token sent as a bearer token, or null when signed out. */
  readonly token = computed(() => this.state()?.token ?? null);

  /**
   * Whether there is a session that has not expired yet. An expired session is cleared, so this
   * also signs the user out locally once the 8 hours are over.
   */
  hasValidSession(): boolean {
    const session = this.state();
    if (session && isExpired(session)) this.clear();
    return this.state() !== null;
  }

  /** Signs in with email and password. Fails with the API's `ApiError`. */
  async signIn(email: string, password: string): Promise<Session> {
    const session = await firstValueFrom(
      this.api.post('/auth/session', { body: { email, password } }),
    );
    this.set(session);
    return session;
  }

  /**
   * Checks the stored session with the API and refreshes the user. A session the API no longer
   * knows (for example after a mock reset) answers `401`, and the interceptor signs out.
   */
  async refresh(): Promise<void> {
    if (!this.state()) return;
    try {
      this.set(await firstValueFrom(this.api.get('/auth/session')));
    } catch {
      // 401 is handled by the interceptor. Other failures keep the stored session.
    }
  }

  /** Ends the session on the server, then locally. Always signs out locally, even if the call fails. */
  async signOut(): Promise<void> {
    try {
      if (this.state()) await firstValueFrom(this.api.delete('/auth/session'));
    } catch {
      // The session ends locally anyway; the server lets it expire.
    } finally {
      this.clear();
    }
  }

  /** Forgets the session without calling the API, for example after a `401`. */
  clear(): void {
    this.state.set(null);
    this.cancelExpiry();
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Storage blocked: the session was only in memory.
    }
  }

  /** The demo account for a role, or null when demo sign-in is off or has no such account. */
  demoAccount(role: RoleKey): DemoAccount | null {
    return this.demo?.accounts.find((account) => account.role === role) ?? null;
  }

  /** Signs in as the demo account for a role. */
  signInAsDemo(role: RoleKey): Promise<Session> {
    const account = this.demoAccount(role);
    if (!this.demo || !account) throw new Error(`No demo account for the ${role} role.`);
    return this.signIn(account.email, this.demo.password);
  }

  /** Signs out and signs in again as the demo account for the other role. */
  async switchDemoRole(role: RoleKey): Promise<Session> {
    await this.signOut();
    return this.signInAsDemo(role);
  }

  private set(session: Session): void {
    this.state.set(session);
    this.scheduleExpiry();
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage blocked: the session lasts until the page is reloaded.
    }
  }

  /** Signs out locally when the current session reaches `expiresAt`. */
  private scheduleExpiry(): void {
    this.cancelExpiry();
    const session = this.state();
    if (!session) return;
    const wait = Date.parse(session.expiresAt) - Date.now();
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null;
        if (this.state() !== session) return;
        if (isExpired(session)) this.endSession();
        else this.scheduleExpiry();
      },
      Math.min(Math.max(wait, 0), MAX_TIMER_MS),
    );
  }

  private cancelExpiry(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  /**
   * Another tab changed the stored session. Follow it: signed out there means signed out here, a
   * new session (sign-in or demo role switch) replaces this one, and the page is checked again
   * for the new user's role.
   */
  private syncFromOtherTab(event: StorageEvent): void {
    // `key` is null when the other tab cleared all of localStorage.
    if (!this.storage || (event.key !== null && event.key !== STORAGE_KEY)) return;
    const next = this.restore();
    if (next?.token === this.state()?.token) return;

    this.state.set(next);
    this.scheduleExpiry();
    if (!next) {
      this.openLogin();
      return;
    }
    // Navigate even to the same URL, so the role guard checks the page again.
    void this.router.navigateByUrl(this.pageAfterOtherTabSignIn(next), {
      onSameUrlNavigation: 'reload',
    });
  }

  /**
   * Where this tab goes when another tab starts a new session:
   * - On the login page: where the login page itself would go, its `returnUrl`.
   * - On any other page: the page in the address bar. On the no-access page that is the page the
   *   user opened, so it opens once the new role may see it.
   * A page in another role's area, the login page and the no-access page lead to `/`, the new
   * user's home.
   */
  private pageAfterOtherTabSignIn(session: Session): string {
    const shown = this.router.parseUrl(addressBarUrl(this.location));
    const target = isLoginPage(shown)
      ? shown.queryParamMap.get('returnUrl')
      : this.router.serializeUrl(shown);
    return safeReturnUrl(target, session.user.role);
  }

  /**
   * Forgets the session and opens the login page, which returns to the page in the address bar
   * after signing in. For a session that has ended: expired, or answered `401` by the API.
   */
  endSession(): void {
    this.clear();
    this.openLogin();
  }

  /** Opens the login page, with the page in the address bar as its `returnUrl`. */
  private openLogin(): void {
    const shown = addressBarUrl(this.location);
    if (isLoginPage(this.router.parseUrl(shown))) return;
    void this.router.navigate([`/${LOGIN_PATH}`], { queryParams: returnUrlParams(shown) });
  }

  private restore(): Session | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Session;
      if (typeof session?.token === 'string' && session.user && !isExpired(session)) {
        return session;
      }
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Unreadable or blocked storage: start signed out.
    }
    return null;
  }
}

function isExpired(session: Session): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}
