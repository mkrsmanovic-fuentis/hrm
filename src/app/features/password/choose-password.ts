import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { disabled, form, FormField, submit, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  SdButton,
  SdCallout,
  SdField,
  SdPanel,
  SdPanelSection,
  SdPassword,
  SdSkeleton,
} from '@specora-dev/ui-kit';
import { map, throwError } from 'rxjs';
import { ApiClient, ApiError, ProblemType, type AccountLink } from '../../core/api';
import { AuthService, FORGOT_PASSWORD_PATH, LOGIN_PATH } from '../../core/auth';
import { ToastService } from '../../core/toast';
import { AuthPage } from '../../shared/auth-page/auth-page';
import { serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

/** What the link is for. The route sets it in its `data`. */
export type PasswordLinkPurpose = 'invitation' | 'password_reset';

/** Limits from the API spec (`Password`) and the password rules. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Why the link cannot be used. */
type LinkProblem = 'not_found' | 'expired' | 'used';

/** The message for a link that cannot be used, and what to do next. */
interface LinkMessage {
  heading: string;
  text: string;
  /** The primary next step. */
  action: { label: string; url: string };
  /** A second, quieter next step. */
  secondary?: { label: string; url: string };
}

const SIGN_IN = { label: 'Go to sign in', url: `/${LOGIN_PATH}` };
const NEW_RESET = { label: 'Request a new link', url: `/${FORGOT_PASSWORD_PATH}` };

const TEXT: Record<
  PasswordLinkPurpose,
  {
    title: string;
    submit: string;
    intro: (link: AccountLink) => string;
    toast: (link: AccountLink) => [heading: string, message: string];
    problems: Record<LinkProblem, LinkMessage>;
  }
> = {
  invitation: {
    title: 'Set your password',
    submit: 'Set password',
    intro: (link) =>
      `Hi ${link.firstName}. Choose a password for ${link.email} to finish setting up your account.`,
    toast: (link) => ['Password set', `Welcome, ${link.firstName}. You are signed in.`],
    problems: {
      expired: {
        heading: 'This invite link has expired',
        text: 'Invite links work for 7 days. Ask your administrator to send you a new invite.',
        action: SIGN_IN,
      },
      used: {
        heading: 'Your password is already set',
        text: 'This invite link was used already. Sign in with your email and password. If you forgot your password, you can reset it.',
        action: SIGN_IN,
        secondary: { label: 'Forgot password?', url: `/${FORGOT_PASSWORD_PATH}` },
      },
      not_found: {
        heading: 'This invite link is not valid',
        text: 'A newer invite may have replaced it, or the link was not copied in full. Use the link from your latest invite, or ask your administrator to send you a new invite.',
        action: SIGN_IN,
      },
    },
  },
  password_reset: {
    title: 'Reset your password',
    submit: 'Reset password',
    intro: (link) =>
      `Choose a new password for ${link.email}. Resetting it signs you out on every other device.`,
    toast: () => [
      'Password changed',
      'You are signed in with your new password. Your other sessions were signed out.',
    ],
    problems: {
      expired: {
        heading: 'This reset link has expired',
        text: 'Password reset links work for 1 hour. Request a new link to reset your password.',
        action: NEW_RESET,
        secondary: SIGN_IN,
      },
      used: {
        heading: 'This reset link was used already',
        text: 'Each reset link works once. Sign in with your new password, or request a new link.',
        action: SIGN_IN,
        secondary: NEW_RESET,
      },
      not_found: {
        heading: 'This reset link is not valid',
        text: 'A newer reset link may have replaced it, or the link was not copied in full. Request a new link to reset your password.',
        action: NEW_RESET,
        secondary: SIGN_IN,
      },
    },
  },
};

/** The link problem an API error stands for, or null for other errors. */
function linkProblemOf(error: unknown): LinkProblem | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.problem.type) {
    case ProblemType.linkExpired:
      return 'expired';
    case ProblemType.linkUsed:
      return 'used';
    case ProblemType.linkNotFound:
      return 'not_found';
    default:
      return null;
  }
}

/**
 * The public pages that invite and password reset links open: `/set-password?token=…` and
 * `/reset-password?token=…`. The route's `data.purpose` (`invitation` or `password_reset`) picks
 * which. No sign-in is needed: the token in the link is the proof.
 *
 * 1. Checks the link with the API. An expired, used or unknown link shows what to do next.
 * 2. The user types a new password twice. The form checks the password rules the API checks.
 * 3. On success the API returns a session: the user is signed in and lands on their home page.
 */
@Component({
  selector: 'app-choose-password',
  imports: [
    AuthPage,
    FormField,
    RouterLink,
    SdButton,
    SdCallout,
    SdField,
    SdPanel,
    SdPanelSection,
    SdPassword,
    SdSkeleton,
  ],
  templateUrl: './choose-password.html',
  styleUrl: './choose-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChoosePassword {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  private readonly route = inject(ActivatedRoute);

  /** What the link is for, from the route's `data.purpose`. */
  readonly purpose = signal<PasswordLinkPurpose>(
    this.route.snapshot.data['purpose'] === 'password_reset' ? 'password_reset' : 'invitation',
  );
  /** The `token` query parameter of the link. */
  readonly token = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('token'))), {
    initialValue: this.route.snapshot.queryParamMap.get('token'),
  });

  protected readonly text = computed(() => TEXT[this.purpose()]);

  /** Who the link is for, checked with the API when the page opens. */
  protected readonly link = rxResource({
    params: () => ({ token: this.token()?.trim() ?? '', purpose: this.purpose() }),
    stream: ({ params: { token, purpose } }) => {
      if (!token) return throwError(() => missingToken());
      return purpose === 'invitation'
        ? this.api.get('/auth/invitations/{invitationToken}', {
            path: { invitationToken: token },
          })
        : this.api.get('/auth/password-resets/{passwordResetToken}', {
            path: { passwordResetToken: token },
          });
    },
  });

  /** A link problem found when saving, for example a link that expired while the page was open. */
  private readonly saveProblem = signal<LinkProblem | null>(null);
  protected readonly saving = signal(false);
  /** Why saving failed, when it was not the link or a field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly problem = computed<LinkMessage | null>(() => {
    const problem = this.saveProblem() ?? linkProblemOf(this.link.error());
    return problem ? this.text().problems[problem] : null;
  });
  /** The check failed for another reason, such as a network error. */
  protected readonly checkFailed = computed(
    () => this.link.status() === 'error' && linkProblemOf(this.link.error()) === null,
  );

  protected readonly model = signal({ password: '', confirmation: '' });
  protected readonly f = form(this.model, (p) => {
    validate(p.password, ({ value }) => passwordError(value(), this.link.value()?.email ?? ''));
    validate(p.confirmation, ({ value, valueOf }) => {
      if (value() === '') return { kind: 'required', message: 'Enter the password again.' };
      return value() !== valueOf(p.password)
        ? { kind: 'mismatch', message: 'The passwords do not match.' }
        : undefined;
    });
    disabled(p.password, () => this.saving());
    disabled(p.confirmation, () => this.saving());
  });

  protected readonly visibleError = visibleError;
  protected readonly hint = `At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words make a strong password.`;

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const link = this.link.value();
    const token = this.token()?.trim();
    if (this.saving() || !link || !token) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      this.saving.set(true);
      const { password } = this.model();
      try {
        if (this.purpose() === 'invitation') await this.auth.acceptInvitation(token, password);
        else await this.auth.resetPassword(token, password);
        const [heading, message] = this.text().toast(link);
        this.toasts.success(heading, message);
        await this.router.navigateByUrl('/');
        return undefined;
      } catch (error) {
        const problem = linkProblemOf(error);
        if (problem) {
          this.saveProblem.set(problem);
          return undefined;
        }
        const fieldErrors = serverFieldErrors(error, { password: form.password });
        if (fieldErrors) return fieldErrors;
        this.formError.set('Something went wrong. Try again in a moment.');
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }

  protected retry(): void {
    this.link.reload();
  }
}

/** The password rules, as the API checks them. Passwords are not trimmed. */
export function passwordError(
  password: string,
  email: string,
): { kind: string; message: string } | undefined {
  if (password === '') return { kind: 'required', message: 'Enter a password.' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { kind: 'minLength', message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { kind: 'maxLength', message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return { kind: 'email', message: 'Do not use your email address as your password.' };
  }
  return undefined;
}

/** A link without a token is treated like an unknown one. */
function missingToken(): ApiError {
  return new ApiError({
    type: ProblemType.linkNotFound,
    title: 'Link not valid',
    status: 404,
    detail: 'The link has no token.',
  });
}
