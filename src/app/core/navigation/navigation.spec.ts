import { LucideBuilding2, LucideGraduationCap, LucideHouse } from '@lucide/angular';
import { navItemsFor, type AppNavItem } from './navigation';

describe('navItemsFor', () => {
  const items: AppNavItem[] = [
    { label: 'Home', icon: LucideHouse, route: '/admin/home', role: 'administrator' },
    { label: 'Home', icon: LucideHouse, route: '/my/home', role: 'employee' },
    {
      label: 'Departments',
      icon: LucideBuilding2,
      route: '/admin/departments',
      role: 'administrator',
      section: 'Organization',
    },
    { label: 'My training', icon: LucideGraduationCap, route: '/my/training', role: 'employee' },
  ];

  it('gives administrators only the administrator entries, in order', () => {
    expect(navItemsFor(items, 'administrator')).toEqual([
      { label: 'Home', icon: LucideHouse, route: '/admin/home' },
      {
        label: 'Departments',
        icon: LucideBuilding2,
        route: '/admin/departments',
        section: 'Organization',
      },
    ]);
  });

  it('gives employees only the employee entries, in order', () => {
    expect(navItemsFor(items, 'employee').map((item) => item.route)).toEqual([
      '/my/home',
      '/my/training',
    ]);
  });

  it('gives signed-out users no entries', () => {
    expect(navItemsFor(items, null)).toEqual([]);
  });
});
