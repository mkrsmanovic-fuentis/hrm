import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Shell } from './core/shell/shell';

/** Root component. It only hosts the app shell. */
@Component({
  selector: 'app-root',
  imports: [Shell],
  template: '<app-shell />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
