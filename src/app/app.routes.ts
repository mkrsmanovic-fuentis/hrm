import { Routes } from '@angular/router';
import {
  LOGIN_PATH,
  NO_ACCESS_PATH,
  ROLE_AREAS,
  roleGuard,
  roleHomeRedirect,
  signedInGuard,
  signedOutGuard,
} from './core/auth';
import { Shell } from './core/shell/shell';

/*
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
            path: 'topics',
            title: 'Topics · HRM Platform',
            loadComponent: () => import('./features/topics/topic-list').then((m) => m.TopicList),
          },
          {
            path: 'questionnaires',
            title: 'Questionnaires · HRM Platform',
            loadComponent: () =>
              import('./features/questionnaires/questionnaire-list').then(
                (m) => m.QuestionnaireList,
              ),
          },
          {
            path: 'questionnaires/:questionnaireId',
            title: 'Questionnaire · HRM Platform',
            loadComponent: () =>
              import('./features/questionnaires/questionnaire-detail').then(
                (m) => m.QuestionnaireDetail,
              ),
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
