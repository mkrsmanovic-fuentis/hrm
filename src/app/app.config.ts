import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { navigation } from './app.navigation';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth';
import { provideNavigation } from './core/navigation';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideNavigation(navigation),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
