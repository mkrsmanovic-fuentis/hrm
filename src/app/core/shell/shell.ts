import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { LucideArrowLeftRight, LucideCircleUser, LucideLogOut } from '@lucide/angular';
import {
  SdBadge,
  SdButton,
  SdPopover,
  SdPopoverTrigger,
  SdSidenav,
  SdTopbar,
} from '@specora-dev/ui-kit';
import type { RoleKey } from '../api';
import { AuthService, LOGIN_PATH, ROLE_LABELS } from '../auth';
import { NAV_ITEMS, navItemsFor } from '../navigation';

/**
 * Signed-in layout: the top bar with the user menu, the side navigation for the user's role, and
 * the area where routed pages render. The navigation entries come from `app.navigation.ts`.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterOutlet,
    SdBadge,
    SdButton,
    SdPopover,
    SdPopoverTrigger,
    SdSidenav,
    SdTopbar,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly icons = {
    user: LucideCircleUser,
    switchRole: LucideArrowLeftRight,
    signOut: LucideLogOut,
  };

  private readonly allNavItems = inject(NAV_ITEMS);

  protected readonly user = this.auth.user;
  /** The side navigation entries for the signed-in user's role. */
  protected readonly navItems = computed(() => navItemsFor(this.allNavItems, this.auth.role()));
  protected readonly fullName = computed(() => {
    const user = this.user();
    return user ? `${user.firstName} ${user.lastName}` : '';
  });
  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  /** The role a demo can switch to, or null when there is no demo account for it. */
  protected readonly switchTarget = computed<RoleKey | null>(() => {
    const role = this.auth.role();
    if (!role) return null;
    const other: RoleKey = role === 'administrator' ? 'employee' : 'administrator';
    return this.auth.demoAccount(other) ? other : null;
  });
  protected readonly switchLabel = computed(() => {
    const target = this.switchTarget();
    return target ? `Switch to ${ROLE_LABELS[target].toLowerCase()}` : '';
  });

  /** The menu action in progress, so its button shows a spinner. */
  protected readonly busy = signal<'switch' | 'signOut' | null>(null);

  constructor() {
    // Check the stored session once per page load: an ended session signs out.
    void this.auth.refresh();
  }

  protected async switchRole(menu: SdPopover): Promise<void> {
    const target = this.switchTarget();
    if (!target || this.busy()) return;
    this.busy.set('switch');
    try {
      await this.auth.switchDemoRole(target);
      menu.hide();
      await this.router.navigateByUrl('/');
    } catch {
      // Signed out but not back in: the login page lets the user try again.
      await this.router.navigate([`/${LOGIN_PATH}`]);
    } finally {
      this.busy.set(null);
    }
  }

  protected async signOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('signOut');
    try {
      await this.auth.signOut();
      await this.router.navigate([`/${LOGIN_PATH}`]);
    } finally {
      this.busy.set(null);
    }
  }
}
