import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideHouse, LucideShieldX } from '@lucide/angular';
import { SdButton, SdEmptyState, type SdHeadingLevel } from '@specora-dev/ui-kit';

/**
 * The "no access" state. The no-access page shows it, and features show it in place of content
 * when an API call fails with `403` (`error.isForbidden`). It never signs the user out.
 *
 * @example
 * @if (error()?.isForbidden) {
 *   <app-access-denied description="You don't have permission to see these departments." />
 * }
 */
@Component({
  selector: 'app-access-denied',
  imports: [RouterLink, SdButton, SdEmptyState],
  template: `
    <sd-empty-state
      [icon]="icons.denied"
      [title]="heading()"
      [description]="description()"
      [headingLevel]="headingLevel()"
    >
      @if (homeLink()) {
        <a sd-button routerLink="/" [icon]="icons.home">Go to your home page</a>
      }
    </sd-empty-state>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessDenied {
  readonly heading = input('No access');
  readonly description = input("You don't have permission to see this.");
  /** Renders the heading as `<h1>`–`<h6>`, for a state that stands in for a page or section. */
  readonly headingLevel = input<SdHeadingLevel | null>(null);
  /** Shows a link to the user's home page. */
  readonly homeLink = input(false, { transform: booleanAttribute });

  protected readonly icons = { denied: LucideShieldX, home: LucideHouse };
}
