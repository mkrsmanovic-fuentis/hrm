import type { Route } from '@angular/router';
import { navigation } from './app.navigation';
import { routes } from './app.routes';
import { ROLE_AREAS } from './core/auth';

/** The child routes of a role's area in `app.routes.ts`. */
function areaRoute(area: string): Route | undefined {
  const shell = routes.find((route) => route.path === '' && route.children);
  return shell?.children?.find((route) => route.path === area);
}

describe('app navigation', () => {
  it.each(navigation.map((item) => [item.label, item.role, item.route] as const))(
    '"%s" for the %s points at a page in that role\'s area',
    (_, role, url) => {
      const area = ROLE_AREAS[role];
      const [, first, ...rest] = url.split('/');

      expect(first, `${url} must start with /${area}/`).toBe(area);
      const pages = areaRoute(area)?.children?.map((route) => route.path) ?? [];
      expect(pages, `${url} must be a page in the ${area} area`).toContain(rest.join('/'));
    },
  );

  it('has no two entries for the same role and page', () => {
    const keys = navigation.map((item) => `${item.role} ${item.route}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
