import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The layout of the pages people see before they are signed in: sign in, set or reset a password,
 * forgot password. A narrow centered column with the brand and the page title; the page's content
 * is projected under it.
 *
 * @example
 * <app-auth-page heading="Sign in">
 *   <sd-panel>…</sd-panel>
 * </app-auth-page>
 */
@Component({
  selector: 'app-auth-page',
  template: `
    <div class="page">
      <div class="column">
        <header class="header">
          <span class="brand">HRM Platform</span>
          <h1 class="title">{{ heading() }}</h1>
        </header>
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './auth-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPage {
  /** The page title, as an `<h1>`. */
  readonly heading = input.required<string>();
}
