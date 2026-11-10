import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { disabled, email, form, FormField, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  SdButton,
  SdCallout,
  SdField,
  SdInput,
  SdPanel,
  SdPanelSection,
} from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import { ApiClient, demoLinkOf } from '../../core/api';
import { DEMO_ACCOUNTS, LOGIN_PATH, returnUrlParams } from '../../core/auth';
import { AuthPage } from '../../shared/auth-page/auth-page';
import { DemoLink } from '../../shared/demo-link/demo-link';
import { serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

/** What the page shows after the request was accepted. */
interface Sent {
  email: string;
  /** Demo only: the reset link the mock API created, or null when it created none. */
  demoLink: string | null;
}

/**
 * `/forgot-password`: the user enters their email and gets a password reset link. The answer is
 * the same whether or not the email has an account, so the page never says which.
 *
 * In the demo (`environment.demo`), the confirmation also shows the reset link the mock API sent
 * in `X-Demo-Link`, instead of an email.
 */
@Component({
  selector: 'app-forgot-password',
  imports: [
    AuthPage,
    DemoLink,
    FormField,
    RouterLink,
    SdButton,
    SdCallout,
    SdField,
    SdInput,
    SdPanel,
    SdPanelSection,
  ],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly api = inject(ApiClient);
  private readonly demo = inject(DEMO_ACCOUNTS) !== null;

  protected readonly loginUrl = `/${LOGIN_PATH}`;
  /** The login page's `returnUrl`, kept for **Back to sign in**. */
  protected readonly returnQuery = returnUrlParams(
    inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl') ?? '',
  );
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly sent = signal<Sent | null>(null);

  protected readonly model = signal({ email: '' });
  protected readonly f = form(this.model, (p) => {
    required(p.email, { message: 'Enter your email.' });
    email(p.email, { message: 'Enter a valid email address.' });
    disabled(p.email, () => this.busy());
  });

  protected readonly visibleError = visibleError;

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      this.busy.set(true);
      const address = this.model().email.trim();
      try {
        const response = await firstValueFrom(
          this.api.postWithHeaders('/auth/password-resets', { body: { email: address } }),
        );
        this.sent.set({ email: address, demoLink: this.demo ? demoLinkOf(response) : null });
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, { email: form.email });
        if (fieldErrors) return fieldErrors;
        this.formError.set('Something went wrong. Try again in a moment.');
        return undefined;
      } finally {
        this.busy.set(false);
      }
    });
  }

  /** Back to the form, to try another email. */
  protected again(): void {
    this.sent.set(null);
  }
}
