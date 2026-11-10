import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { SdTopbar } from '@specora-dev/ui-kit';

/**
 * App shell: the top bar and the area where routed pages render.
 * Navigation and the user menu are added in later issues.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet, SdTopbar],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {}
