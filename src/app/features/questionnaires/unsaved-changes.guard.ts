import type { CanDeactivateFn } from '@angular/router';

/** A page that may hold unsaved changes, and asks before they are lost. */
export interface LeaveConfirmation {
  /** Resolves `true` when the page may be left: nothing is unsaved, or the user chose to leave. */
  confirmLeave(): boolean | Promise<boolean>;
}

/**
 * Asks the page before the router leaves it, so unsaved changes are not lost by accident. The
 * page shows its own confirmation, an `<app-confirm-dialog>`. Closing or reloading the browser
 * tab is covered by the page's `beforeunload` handler instead.
 *
 * @example
 * { path: 'questionnaires/:questionnaireId', canDeactivate: [unsavedChangesGuard], loadComponent: … }
 */
export const unsavedChangesGuard: CanDeactivateFn<LeaveConfirmation> = (component) =>
  component?.confirmLeave() ?? true;
