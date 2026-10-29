# Repository Guidelines

## Project Structure & Module Organization

The Angular 21 app lives in `src/`. Keep components in `src/app/`, shared API types and HTTP access in `src/app/core/`, global styles in `src/styles.scss`, and static assets in `public/`. The Node API uses ES modules under `server/`; validation belongs in `server/validation.mjs` and Prisma access in `server/db.mjs`. Schema and timestamped migrations are under `prisma/`. The Capacitor Android project is in `android/`; deployment files and operational notes live in `deploy/` and `docs/`.

## Build, Test, and Development Commands

- `npm ci`: install locked dependencies (Node.js 20+).
- `npm run db:generate && npm run db:migrate && npm run db:seed`: prepare and seed the local SQLite database.
- `npm run start:api`: serve the API on port 3000.
- `npm start`: run Angular on `http://localhost:4200` with `/api` proxied locally.
- `npm run build -- --configuration production`: create the production web bundle in `dist/eat_it_ng/browser`.
- `npm test -- --watch=false`: run Angular/Vitest tests once.
- `npm run test:server`: run Node API integration tests.
- `npm run android:sync`: build the web app and synchronize Android.

## Coding Style & Naming Conventions

Use two-space indentation, UTF-8, final newlines, and single quotes in TypeScript. Prettier uses a 100-character width; run `npx prettier --check .` before formatting-heavy changes. TypeScript and Angular templates are strict, so avoid `any` in production code. Use kebab-case filenames, PascalCase classes/types, camelCase members, and `*.spec.ts` tests. Server files use descriptive lowercase `*.mjs` names.

## Testing Guidelines

Place frontend tests beside their subjects as `*.spec.ts` and use Vitest. API integration tests live in `server/app.test.mjs` and use `node:test` with isolated SQLite. Add focused regression tests for changed behavior. Before a pull request, run the production build and both test commands; these mirror CI's web checks.

## Commit & Pull Request Guidelines

History favors concise, imperative subjects, often with `feat:`, `fix:`, `build:`, or `ci:` prefixes. Keep commits scoped to one logical change. Pull requests should explain user-visible behavior, note schema or configuration changes, link issues, and include screenshots or recordings for UI changes. Confirm build and tests pass; mention Android validation when applicable.

## Security & Configuration

Copy `.env.example` for local configuration, but never commit `.env`, SQLite data, OAuth credentials, VAPID private keys, or Android signing files. Add schema changes as new Prisma migrations rather than editing migrations already deployed.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
