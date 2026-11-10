# CLAUDE.md

HRM Platform: questionnaire-based security awareness training. **Frontend only** for now, running on a mocked API with dummy data. The Angular app lives at the repo root; the Mintlify docs site lives in `docs/` (see `docs/AGENTS.md` for docs work).

## Stack

- Angular 22 (Angular CLI, `@angular/build`), TypeScript strict, SCSS, no SSR.
- UI: [`@specora-dev/ui-kit`](https://github.com/specora-dev/ui-kit) only, with its peers `@angular/cdk` and `@lucide/angular`.
- Tests: Vitest through Angular's unit-test builder (`ng test`), jsdom.
- Lint: angular-eslint (`eslint.config.js`). Format: Prettier (`.prettierrc`, same as ui-kit).
- Package manager: pnpm. Node version: `.nvmrc`.
- ui-kit comes from GitHub Packages. `.npmrc` reads the token from `GH_TOKEN`; never write a token into a file.

## Commands

| Command            | What it does                                                                           |
| ------------------ | -------------------------------------------------------------------------------------- |
| `pnpm install`     | Install dependencies (needs `GH_TOKEN` with `read:packages`).                          |
| `pnpm start`       | Dev server on http://localhost:4200.                                                   |
| `pnpm test`        | Unit tests in watch mode. `pnpm test:ci` runs them once.                               |
| `pnpm lint`        | angular-eslint.                                                                        |
| `pnpm format`      | Format with Prettier. `pnpm format:check` only checks.                                 |
| `pnpm typecheck`   | `tsc` on app and spec code.                                                            |
| `pnpm build`       | Production build to `dist/hrm`.                                                        |
| `pnpm api:types`   | Generate API types from the OpenAPI spec. `api:types:check` verifies.                  |
| `pnpm mock:worker` | Regenerate MSW's `public/mockServiceWorker.js` after updating `msw`.                   |
| **`pnpm check`**   | API types check, lint, format check, type check, tests and production build. The gate. |

Docs checks run from `docs/`: `mint validate` and `mint broken-links`.

## Folder structure

```
src/app/
  app.ts, app.config.ts, app.routes.ts   root component, providers, top-level routes
  core/        app-wide singletons: shell (top bar, layout), auth, API client
  features/    one folder per product area, e.g. features/questionnaires/
  shared/      small pieces reused by several features (pipes, helpers, wrappers around ui-kit compositions)
src/environments/  deployment settings: API base URL, mock on or off
src/mocks/         the in-browser mock API (MSW): handlers, database, seed
```

- Features are lazy-loaded from `app.routes.ts` with `loadComponent` or `loadChildren`.
- Features may import from `core/` and `shared/`, never from another feature.
- Create `shared/` only when something is used by two or more features.

## Angular conventions

Match ui-kit's own conventions:

- Standalone components only, with `changeDetection: ChangeDetectionStrategy.OnPush` set explicitly.
- Signal APIs: `input()`, `output()`, `model()`, `signal()`, `computed()`. No `@Input` / `@Output` decorators.
- `inject()` instead of constructor injection.
- Built-in control flow (`@if`, `@for`, `@switch`).
- Selector prefix `app-`. One component per file, named after the class (`home.ts`, `home.html`, `home.scss`, `home.spec.ts`).
- Every component that has behavior gets a `*.spec.ts` next to it. Test what the user sees, not internals.

## ui-kit rules

- **Read before building UI:** `node_modules/@specora-dev/ui-kit/AGENTS.md` and `node_modules/@specora-dev/ui-kit/docs/manifest.json`. They match the installed version. Read a component's manifest entry before using it; don't guess inputs.
- **Only ui-kit components.** Never add another UI library (Angular Material, PrimeNG, ng-bootstrap, Taiga UI, ng-zorro, Clarity, …). The lint rule `no-restricted-imports` rejects them.
- **Never build your own version** of a component ui-kit provides, and never restyle ui-kit internals (`::ng-deep`, `.sd-*` selectors, `!important`).
- **Tokens only:** `--sd-*` semantic tokens (`--sd-color-*`, `--sd-space-*`, `--sd-font-*`, `--sd-radius-*`, …) from `styles/tokens.css`. No hex values, no primitives (`--sd-neutral-*`, `--sd-green-*`, …). Use rem for sizes that aren't tokens.
- Layout (flex, grid, gaps) is the app's job; components size to their container.
- **Missing component or variant?** Stop and report the gap to the lead: what you need and why. Don't build a workaround.

## Contract-first API rules

- The OpenAPI 3.1 spec at `docs/api-reference/openapi.yaml` is the source of truth for every endpoint. Its conventions (base path `/api/v1`, plural kebab-case URLs, current organization, bearer session token, paging envelope, `application/problem+json` errors) are in `docs/api-reference/overview.mdx`. Follow them.
- TypeScript types are generated from the spec into `src/app/core/api/api-schema.gen.ts` by `pnpm api:types`. Never hand-write API types and never edit the generated file. Commit it; `pnpm check` fails when it is stale.
- Features call the API only through `ApiClient` (`src/app/core/api/`, import from `core/api`). Components never inject `HttpClient`. Calls fail with `ApiError`.
- The mock API (MSW) answers the app's real HTTP calls in the browser. It starts in `src/main.ts` before bootstrap while `environment.mockApi` is `true`. Handlers live in `src/mocks/resources/<resource>/`, the in-memory database in `src/mocks/db/`, the seed in `src/mocks/seed/`, mirrored business rules in `src/mocks/rules/`.
- **Never hard-code data in components.** Data comes from the API client, which the mock serves.
- Changing data means changing the spec first, then regenerating types and updating the mock, in the same pull request.

To add an endpoint (full guide: `docs/developer-guide/mock-api.mdx`):

1. **Spec:** add the path and schemas to `docs/api-reference/openapi.yaml`, with `operationId`, one tag, `x-mint: *spec-status` and the shared parameters and error responses. Update `docs/developer-guide/data-model.mdx` if fields change.
2. **Types:** `pnpm api:types`, then commit `src/app/core/api/api-schema.gen.ts`.
3. **Client:** call `inject(ApiClient).get('/path/{id}', { path, query })` (or `post`, `put`, `patch`, `delete`). Paths and bodies are type-checked against the spec.
4. **Handler:** `route.get('/path', (ctx) => …)` in `src/mocks/resources/<resource>/<resource>.handlers.ts`, added to `mockRoutes` in `src/mocks/handlers.ts`. Validate input (`ctx.query`, `ctx.validationFailed`), answer errors as problems, change data only in `ctx.db.update()`, return lists through `ctx.page()`. **Administrator create, edit, deactivate and reactivate handlers call `recordAudit()`** from `src/mocks/db/audit.ts` in the same `db.update()`.
5. **Seed:** add data in `src/mocks/seed/` with `SeededRandom` (never `Math.random()`), and bump `SEED_VERSION`.
6. **Tests:** `<resource>.handlers.spec.ts` with `createTestMockApi()` from `src/mocks/testing.ts`.

Mock helpers while running the app: `?mock-reset` restores the seed; `?mock-delay=1500`, `?mock-error=forbidden|server|<status>`, `?mock-empty`, `?mock-scope=/topics` simulate states; `?mock-clear` turns them off.

## Definition of done

1. `pnpm check` passes.
2. If the feature's data changed: the API spec, the generated types and the mock are updated. Administrator write handlers record an audit log entry ([rules](docs/developer-guide/business-rules.mdx#audit-log)).
3. Docs are updated in the same pull request, following `docs/AGENTS.md`: user guide pages for what users see, developer guide pages and business rules for behavior, the API spec for endpoints. `mint validate` and `mint broken-links` pass in `docs/`.
4. `docs/changelog.mdx` is never edited by workers. The lead adds release entries after merge.
5. The work stays inside the issue's scope. Extra work found along the way is reported to the lead, not done.
