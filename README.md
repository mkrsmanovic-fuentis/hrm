# HRM Platform

Questionnaire-based security awareness training platform. Frontend only for now, running on a mocked API.

## App

An Angular 22 app at the repo root, built only with the [`@specora-dev/ui-kit`](https://github.com/specora-dev/ui-kit) components. You need Node (version in `.nvmrc`) and pnpm.

ui-kit is installed from GitHub Packages, so you need a classic GitHub token with the `read:packages` scope, exported as `GH_TOKEN`. `.npmrc` reads it from the environment; never commit a token.

```bash
export GH_TOKEN=<your token>
pnpm install
pnpm start      # http://localhost:4200
pnpm check      # lint, format, types, tests and production build
```

Full setup steps are in the [developer guide](docs/developer-guide/overview.mdx#local-setup). Conventions for contributors and coding agents are in [`CLAUDE.md`](CLAUDE.md).

## Documentation

The Mintlify docs site lives in [`docs/`](docs/). To preview it locally:

```bash
npm i -g mint
cd docs
mint dev
```

Then open http://localhost:3000. Changes pushed to `main` are published automatically.
