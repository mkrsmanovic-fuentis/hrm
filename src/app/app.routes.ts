import { Routes } from '@angular/router';
import {
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  NO_ACCESS_PATH,
  RESET_PASSWORD_PATH,
  ROLE_AREAS,
  roleGuard,
  roleHomeRedirect,
  signedInGuard,
  SET_PASSWORD_PATH,
  signedOutGuard,
} from './core/auth';
import { Shell } from './core/shell/shell';

/*
 * Public pages, outside the shell: sign in, forgot password, and the pages that invite and
 * password reset links open. The link pages have no guard: someone who is signed in can still open
 * a link, and setting the password signs them in as the link's user.
 *
 * Pages behind sign-in live in one of two areas:
 * - /admin: administrator pages. roleGuard('administrator') covers every child.
 * - /my: employee pages. roleGuard('employee') covers every child.
 *
 * To add a page, add a child route to its area and, if it belongs in the side navigation, one
 * entry in app.navigation.ts. See docs/developer-guide/access-control.mdx.
 */
export const routes: Routes = [
  {
    path: LOGIN_PATH,
    title: 'Sign in · HRM Platform',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: FORGOT_PASSWORD_PATH,
    title: 'Forgot password · HRM Platform',
    canActivate: [signedOutGuard],
    loadComponent: () =>
      import('./features/password/forgot-password').then((m) => m.ForgotPassword),
  },
  {
    path: SET_PASSWORD_PATH,
    title: 'Set your password · HRM Platform',
    data: { purpose: 'invitation' },
    loadComponent: () =>
      import('./features/password/choose-password').then((m) => m.ChoosePassword),
  },
  {
    path: RESET_PASSWORD_PATH,
    title: 'Reset your password · HRM Platform',
    data: { purpose: 'password_reset' },
    loadComponent: () =>
      import('./features/password/choose-password').then((m) => m.ChoosePassword),
  },
  {
    // Every page behind sign-in renders inside the shell.
    path: '',
    component: Shell,
    canActivate: [signedInGuard],
    canActivateChild: [signedInGuard],
    children: [
      // `/` opens the signed-in user's home page.
      { path: '', pathMatch: 'full', redirectTo: roleHomeRedirect },
      {
        path: NO_ACCESS_PATH,
        title: 'No access · HRM Platform',
        loadComponent: () => import('./core/access/no-access').then((m) => m.NoAccess),
      },
      {
        path: ROLE_AREAS.administrator,
        canActivate: [roleGuard('administrator')],
        canActivateChild: [roleGuard('administrator')],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          {
            path: 'home',
            title: 'Home · HRM Platform',
            loadComponent: () => import('./features/home/home').then((m) => m.Home),
          },
          {
            path: 'departments',
            title: 'Departments · HRM Platform',
            loadComponent: () =>
              import('./features/departments/department-list').then((m) => m.DepartmentList),
          },
          {
            path: 'employees',
            title: 'Employees · HRM Platform',
            loadComponent: () =>
              import('./features/employees/employee-list').then((m) => m.EmployeeList),
          },
          {
            path: 'topics',
            title: 'Topics · HRM Platform',
            loadComponent: () => import('./features/topics/topic-list').then((m) => m.TopicList),
          },
        ],
      },
      {
        path: ROLE_AREAS.employee,
        canActivate: [roleGuard('employee')],
        canActivateChild: [roleGuard('employee')],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'home' },
          {
            path: 'home',
            title: 'Home · HRM Platform',
            loadComponent: () => import('./features/home/home').then((m) => m.Home),
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
