import { Routes } from '@angular/router';
import { LOGIN_PATH, signedInGuard, signedOutGuard } from './core/auth';
import { Shell } from './core/shell/shell';

export const routes: Routes = [
  {
    path: LOGIN_PATH,
    title: 'Sign in · HRM Platform',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    // Every page behind sign-in renders inside the shell.
    path: '',
    component: Shell,
    canActivate: [signedInGuard],
    canActivateChild: [signedInGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'HRM Platform',
        loadComponent: () => import('./features/home/home').then((m) => m.Home),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
