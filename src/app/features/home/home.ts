import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SdEmptyState, SdPanel, SdStatusBar } from '@specora-dev/ui-kit';

/** Placeholder home page that proves the ui-kit setup. Real pages replace it in later issues. */
@Component({
  selector: 'app-home',
  imports: [SdEmptyState, SdPanel, SdStatusBar],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {}
