# Homie roadmap

Status legend: `[x]` implemented, `[~]` in progress, `[ ]` planned.

## Current milestone: stable beta v0.3

- [x] Restore a reproducible local build and green frontend/API test baseline.
- [ ] Update vulnerable Angular dependencies and review the remaining Prisma advisory.
- [x] Complete the core flow from fridge contents to a recipe and missing shopping items.
- [ ] Close the remaining account, notification, and production-readiness gaps below.

## Stage 1: Persistent core data - complete

- [x] Node.js API and SQLite database.
- [x] Fridge and shopping list synchronization.
- [x] Create, edit, consume, move, complete, and delete operations.
- [x] Loading and network error states.
- [x] Web and API deployment instructions.

## Stage 2: Accounts and households - nearly complete

- [x] Email/password registration and sign-in.
- [x] Google and Apple OAuth server flows; provider credentials are required.
- [x] Account deletion and household data isolation.
- [x] Partner invitations with household data merging.
- [ ] Password recovery.
- [ ] Owner/member roles and permission checks.
- [ ] Explicit migration of pre-account anonymous data.

## Stage 3: Recipes and recommendations - in progress

- [x] Recipe details, ingredients, steps, images, and localization.
- [x] Local and user-created recipe catalogs, including create and delete operations.
- [x] Ingredient matching against the fridge, with Spoonacular fallback.
- [x] Recipe search and filters for availability, ownership, and saved recipes.
- [x] Add missing ingredients to the shopping list without duplicates.
- [x] Prioritize recipes that use products approaching expiration.

## Stage 4: Dish matching and notifications - in progress

- [x] Expiration, shopping-list, and invitation notifications.
- [x] Web Push subscriptions for supported browsers and installed iOS PWA.
- [ ] Verify push delivery in the Capacitor Android app and target browsers.
- [ ] Notification preferences by event type and quiet hours.
- [ ] Dish swipe history and partner matches.

## Stage 5: Production hardening - started

- [x] HTTPS/Nginx configuration and automated production deployment.
- [x] CI web build, frontend tests, API tests, and Android debug APK.
- [x] Privacy and account-deletion pages.
- [x] Signed Android AAB workflow and Google Play release instructions.
- [ ] Rate limiting, audit logging, monitoring, and automated database backups.
- [ ] Import/export, accessibility review, offline support, and end-to-end tests.
- [ ] Release versioning and repeatable web/Android smoke-test checklist.
