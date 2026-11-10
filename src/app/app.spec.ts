import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App shell', () => {
  async function renderAt(url: string) {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the ui-kit top bar with a brand link to the home page', async () => {
    const element = await renderAt('/');

    const brand = element.querySelector<HTMLAnchorElement>('sd-topbar a[sdTopbarStart]');
    expect(brand?.textContent?.trim()).toBe('HRM Platform');
    expect(brand?.getAttribute('href')).toBe('/');
  });

  it('renders the home page inside the main area', async () => {
    const element = await renderAt('/');

    const main = element.querySelector('main');
    expect(main?.querySelector('app-home sd-status-bar')?.textContent).toContain('Home');
    expect(main?.querySelector('sd-empty-state')?.textContent).toContain('Nothing here yet');
    expect(TestBed.inject(Title).getTitle()).toBe('HRM Platform');
  });

  it('redirects unknown URLs to the home page', async () => {
    const element = await renderAt('/does-not-exist');

    expect(TestBed.inject(Router).url).toBe('/');
    expect(element.querySelector('app-home')).not.toBeNull();
  });
});
