/** App-wide settings that change between deployments. */
export const environment = {
  /** Base path of the HRM Platform API. Paths in the OpenAPI spec are relative to it. */
  apiBaseUrl: '/api/v1',
  /**
   * Serve the API from the in-browser mock (MSW) instead of a real backend.
   * Always on while the project is frontend only. See docs/developer-guide/mock-api.mdx.
   */
  mockApi: true,
};
