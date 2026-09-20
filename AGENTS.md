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
