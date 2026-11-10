import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  disabled,
  email,
  form,
  FormField,
  required,
  submit,
  type FieldTree,
} from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  SdButton,
  SdCallout,
  SdField,
  SdInput,
  SdPanel,
  SdPanelSection,
  SdPassword,
} from '@specora-dev/ui-kit';
import { ApiError, ProblemType, type RoleKey } from '../../core/api';
import {
  AuthService,
  FORGOT_PASSWORD_PATH,
  returnUrlParams,
  ROLE_LABELS,
  safeReturnUrl,
} from '../../core/auth';
import { AuthPage } from '../../shared/auth-page/auth-page';

/** What the error callout says when signing in fails. */
interface SignInError {
  heading: string;
  message: string;
}

/**
 * The login page: email and password, plus one-click sign-in with the demo accounts when the
 * environment has them. **Forgot password?** opens the page that sends a reset link.
 */
@Component({
  selector: 'app-login',
  imports: [
    AuthPage,
    FormField,
    RouterLink,
    SdButton,
    SdCallout,
    SdField,
    SdInput,
    SdPanel,
    SdPanelSection,
    SdPassword,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly forgotPasswordUrl = `/${FORGOT_PASSWORD_PATH}`;
  /** Keeps `returnUrl` on the way to Forgot password and back. */
  protected readonly returnQuery = returnUrlParams(
    this.route.snapshot.queryParamMap.get('returnUrl') ?? '',
  );

  /** The sign-in in progress: the form, or a demo account. */
  protected readonly busy = signal<'form' | RoleKey | null>(null);
  protected readonly error = signal<SignInError | null>(null);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Enter your email.' });
    email(p.email, { message: 'Enter a valid email address.' });
    required(p.password, { message: 'Enter your password.' });
    disabled(p.email, () => this.busy() !== null);
    disabled(p.password, () => this.busy() !== null);
  });

  protected readonly demoAccounts = (['administrator', 'employee'] as const)
    .filter((role) => this.auth.demoAccount(role))
    .map((role) => ({ role, label: `Sign in as ${ROLE_LABELS[role]}` }));

  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    await submit(this.f, async () => {
      const { email, password } = this.model();
      await this.run('form', () => this.auth.signIn(email.trim(), password));
      return undefined;
    });
  }

  protected async signInAsDemo(role: RoleKey): Promise<void> {
    if (this.busy()) return;
    await this.run(role, () => this.auth.signInAsDemo(role));
  }

  protected visibleError<T>(field: FieldTree<T>): string | null {
    const state = field();
    if (!state.touched() || !state.invalid()) return null;
    return state.errors()[0]?.message ?? null;
  }

  private async run(busy: 'form' | RoleKey, signIn: () => Promise<unknown>): Promise<void> {
    this.busy.set(busy);
    this.error.set(null);
    try {
      await signIn();
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(safeReturnUrl(returnUrl, this.auth.role()));
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      this.busy.set(null);
    }
  }
}

function describe(error: unknown): SignInError {
  const type = error instanceof ApiError ? error.problem.type : null;
  if (type === ProblemType.invalidCredentials) {
    return {
      heading: 'Wrong email or password',
      message: 'Check your email and password and try again.',
    };
  }
  if (type === ProblemType.accountInactive) {
    return {
      heading: 'Account deactivated',
      message: 'Your account is deactivated. Ask an administrator to reactivate it.',
    };
  }
  return {
    heading: 'Could not sign in',
    message: 'Something went wrong. Try again in a moment.',
  };
}
