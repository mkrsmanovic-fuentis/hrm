# Docs instructions for coding agents

If you can run shell commands, run `mint instructions` before any Mintlify task and read the topic that matches it. It prints current guidance for this CLI version. If `mint` is missing, run `npx mint@latest instructions`.

## About this site

- Mintlify docs for HRM Platform, a security awareness training platform.
- This folder (`docs/`) is the docs root. `docs.json` lives here. Run all `mint` commands from here.
- Pushing to `main` publishes the site.
- The product is a frontend demo running on a mocked API. The API is designed contract-first: the OpenAPI spec in `api-reference/` is the source of truth.

## Rules

- Follow the full guide in `developer-guide/writing-docs.mdx`: where pages go, templates, style and terms.
- Start new pages from `_templates/`.
- Add every new page to `navigation` in `docs.json`.
- Never describe unbuilt features as working. Mark backend behavior with `<SpecStatus />` from `/snippets/spec-status.mdx`.
- Never invent product facts. If something is unknown, leave a `{/* TODO: ... */}` comment and report it.
- Business rules belong in `developer-guide/business-rules.mdx`. Other pages link to it.
- API endpoint pages are generated from the OpenAPI spec. Change the spec, not generated pages.

## Before you finish

Run `mint validate` and `mint broken-links`. Both must pass.
