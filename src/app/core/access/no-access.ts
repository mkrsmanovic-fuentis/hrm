import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SdPanel } from '@specora-dev/ui-kit';
import { AccessDenied } from './access-denied';

/**
 * The page `roleGuard` shows when a user opens a page their role may not see, for example an
 * employee opening `/admin/home`. The address bar keeps the URL they opened.
 */
@Component({
  selector: 'app-no-access',
  imports: [AccessDenied, SdPanel],
  template: `
    <sd-panel>
      <app-access-denied
        [headingLevel]="1"
        description="Your role doesn't have access to this page."
        homeLink
      />
    </sd-panel>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoAccess {}
