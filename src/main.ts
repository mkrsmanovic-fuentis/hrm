import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

async function bootstrap(): Promise<void> {
  if (environment.mockApi) {
    // Loaded lazily, so the mock stays out of the main bundle and drops out entirely when switched off.
    const { startMockApi } = await import('./mocks/browser');
    await startMockApi();
  }
  await bootstrapApplication(App, appConfig);
}

bootstrap().catch((err) => console.error(err));
