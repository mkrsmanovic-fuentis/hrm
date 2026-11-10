/** A seeded account the login page offers for one-click demo sign-in. */
export interface DemoAccount {
  role: 'administrator' | 'employee';
  email: string;
}

/** App-wide settings that change between deployments. */
export const environment: {
  apiBaseUrl: string;
  mockApi: boolean;
  demo: { password: string; accounts: DemoAccount[] } | null;
} = {
  /** Base path of the HRM Platform API. Paths in the OpenAPI spec are relative to it. */
  apiBaseUrl: '/api/v1',
  /**
   * Serve the API from the in-browser mock (MSW) instead of a real backend.
   * Always on while the project is frontend only. See docs/developer-guide/mock-api.mdx.
   */
  mockApi: true,
  /**
   * Demo accounts: one-click sign-in on the login page and the role switch in the user menu.
   * They must exist in the mock seed with this password. Set to `null` to hide both, for example
   * with a real backend. See docs/developer-guide/authentication.mdx.
   */
  demo: {
    password: 'demo-2026',
    accounts: [
      { role: 'administrator', email: 'maja.novak@brightwater.example' },
      { role: 'employee', email: 'amelia.hughes@brightwater.example' },
    ],
  },
};
