import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SdCallout, SdEmptyState, SdPanel, SdSkeleton, SdStatusBar } from '@specora-dev/ui-kit';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError } from '../../core/api';

/**
 * Placeholder home page for both roles, showing the current organization. The administrator and
 * employee dashboards replace it in later issues.
 *
 * It is also the reference for handling a `403`: the page shows the "no access" state in place of
 * its content, and the user stays signed in.
 */
@Component({
  selector: 'app-home',
  imports: [AccessDenied, SdCallout, SdEmptyState, SdPanel, SdSkeleton, SdStatusBar],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly api = inject(ApiClient);

  protected readonly organization = rxResource({ stream: () => this.api.get('/organization') });

  /** The failure, as an ApiError, or null while loading or after success. */
  protected readonly error = computed(() => {
    const error = this.organization.error();
    if (!error) return null;
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.organization.status() === 'error');
}
