# Graph Report - eat_it_ng  (2026-10-29)

## Corpus Check
- 85 files · ~61,512 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 31 file(s) not represented in the graph (top: .xml 10, (none) 5, .example 2)

## Summary
- 881 nodes · 1655 edges · 101 communities (34 shown, 67 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a6cfa48d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- API Validation Layer
- Angular Application Logic
- Angular Workspace Configuration
- Server API Core
- Frontend API Models
- Package Dependencies
- Recipe Domain Types
- Shared Data Models
- Dish Matching Logic
- Project Scripts
- Capacitor Build Tooling
- Main Application Interface
- Recipe Catalog Integration
- live-update.service.ts
- OAuth Authentication
- Recipe Picker Session
- db.mjs
- ShoppingItem
- Android Instrumentation Tests
- Repository Guidelines
- LoadMoreDirective
- createAndSendNotification
- FridgeItem
- CI Build Pipeline
- Android Signing Secrets
- Angular Bootstrap
- vitest
- auth.mjs
- @capacitor/cli
- @angular/forms
- LiveUpdateService
- CI Cache Configuration
- Live Update Tests
- Recipe Suggestion Models
- CI Workflow Steps
- Signed Android Bundle
- Production Deployment Workflow
- Dependency Overrides
- Notification Data Flow
- CI Branch Triggers
- @angular/platform-browser
- Meal Planning
- @capacitor/android@^7.6.0
- Android Splash Composition
- @ngrx/entity@^21.1.0
- @ngrx/store@^21.1.0
- Android Main Activity
- Play Store Compliance
- Production Migration Docs
- Domain and OTA Migration
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Splash Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Android Launcher Assets
- Product Roadmap
- Swipe Regression Analysis
- Homie Apple Icon
- Homie Web Icon
- Homie Brand Logo
- Play Feature Artwork
- Play Store Icon
- Play Store Icon Variant
- Product Inventory Screenshot
- Shopping List Screenshot
- Web Application Shell

## God Nodes (most connected - your core abstractions)
1. `App` - 189 edges
2. `createApiServer()` - 68 edges
3. `ApiService` - 68 edges
4. `scripts` - 20 edges
5. `FridgeItem` - 14 edges
6. `RecipeSuggestion` - 13 edges
7. `ShoppingItem` - 12 edges
8. `@angular/core` - 11 edges
9. `normalizeProductName()` - 11 edges
10. `matchedDishSuggestions()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Google Play release` --publishes_url_for--> `Public account deletion page`  [EXTRACTED]
  docs/PLAY_RELEASE.md → public/delete-account.html
- `Google Play release` --publishes_url_for--> `Homie privacy policy`  [EXTRACTED]
  docs/PLAY_RELEASE.md → public/privacy.html
- `Production deployment` --references--> `Production VPS migration`  [EXTRACTED]
  README.md → docs/SERVER_MIGRATION.md
- `sendPushNotification()` --calls--> `isTrustedPushEndpoint()`  [EXTRACTED]
  server/app.mjs → server/validation.mjs
- `createApiServer()` --calls--> `authenticate()`  [EXTRACTED]
  server/app.mjs → server/auth.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Основные разделы нижней навигации** — src_app_app_bottom_navigation, src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_random_recipe_picker, src_app_app_recipe_catalog, src_app_app_profile_hub [EXTRACTED 1.00]
- **Совместная работа участников дома** — src_app_app_household_group, src_app_app_notification_center, src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_recipe_catalog [INFERRED 0.85]
- **Основной цикл управления домашним питанием** — src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_recipe_catalog, src_app_app_recipe_detail, src_app_app_meal_planner [INFERRED 0.95]

## Communities (101 total, 67 thin omitted)

### Community 0 - "API Validation Layer"
Cohesion: 0.05
Nodes (54): zod, CAPACITOR_ORIGINS, catalogPageRequests, catalogTranslationWork, dayKey(), DEFAULT_ADMIN_EMAILS, emptyDailyBuckets(), ENGLISH_INGREDIENT_ALIASES (+46 more)

### Community 2 - "Angular Workspace Configuration"
Cohesion: 0.05
Nodes (42): build, serve, test, builder, configurations, defaultConfiguration, options, cli (+34 more)

### Community 3 - "Server API Core"
Cohesion: 0.07
Nodes (40): adminEmails(), appLocation(), applyCapacitorCors(), authResponse(), createApiServer(), createHouseholdForUser(), dailyCounts(), findFridgeItem() (+32 more)

### Community 4 - "Frontend API Models"
Cohesion: 0.10
Nodes (7): ApiService, DevProduct, FeedbackItem, Household, NotificationPreferences, SupportMessage, SupportTicket

### Community 5 - "Package Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, @angular/cdk@^21.2.14, @angular/compiler@^21.2.25, @angular/material@^21.2.14, jose@^6.2.3, @ngrx/effects@^21.1.0, @ngrx/store-devtools@^21.1.0, @prisma/client@^6.19.3 (+14 more)

### Community 6 - "Recipe Domain Types"
Cohesion: 0.09
Nodes (25): AuthMode, DevSection, DishIdea, FridgeSort, FridgeStatusFilter, LEGACY_DEMO_RECIPE_TITLES, ONBOARDING_STEPS, OnboardingStep (+17 more)

### Community 7 - "Shared Data Models"
Cohesion: 0.10
Nodes (14): AppState, AuthProviders, AuthResponse, AuthUser, DevRecipe, DevSummary, DevUser, HouseholdSubscription (+6 more)

### Community 9 - "Dish Matching Logic"
Cohesion: 0.19
Nodes (21): addMissingDishIngredientsToShopping(), canonicalIngredientName(), ensureCatalogLocalized(), formatIngredient(), fridgeItemIsExpiring(), importRecipeSuggestions(), ingredientEnding(), matchedDishSuggestions() (+13 more)

### Community 11 - "Project Scripts"
Cohesion: 0.10
Nodes (20): scripts, admin:grant, android:aab, android:apk, android:sync, build, db:generate, db:migrate (+12 more)

### Community 12 - "Capacitor Build Tooling"
Cohesion: 0.14
Nodes (19): devDependencies, @angular/build@^21.2.24, @angular/cli@^21.2.24, @angular/compiler-cli@^21.2.25, jsdom@^28.0.0, prettier@^3.8.1, prisma@^6.19.3, typescript@~5.9.2 (+11 more)

### Community 13 - "Main Application Interface"
Cohesion: 0.19
Nodes (19): Удаление аккаунта, Аутентификация и регистрация, Главная нижняя навигация, Административный Dev center, Обратная связь об идеях и ошибках, Подписка Homie Plus, Общий дом и участники, Управление домашними запасами (+11 more)

### Community 14 - "Recipe Catalog Integration"
Cohesion: 0.22
Nodes (17): catalogPageKey(), fetchCatalogPage(), fetchPopularRecipeSuggestions(), fetchRecipeInformationBulk(), fetchRecipeSuggestions(), loadCatalogPage(), plainText(), recipeSteps() (+9 more)

### Community 15 - "live-update.service.ts"
Cohesion: 0.23
Nodes (9): @capacitor/core@^7.6.0, @capgo/capacitor-updater@7.51.23, @capacitor/core, @capgo/capacitor-updater, bundle, manifest, verifyManifest, UPDATE_MANIFEST_VERIFIER (+1 more)

### Community 16 - "OAuth Authentication"
Cohesion: 0.21
Nodes (14): appleAuthorization(), appleClientSecret(), appleKeys, baseUrl(), challenge(), clearOauthCookie(), cookieValue(), exchangeAppleCode() (+6 more)

### Community 19 - "db.mjs"
Cohesion: 0.05
Nodes (36): main(), nativeFingerprint(), root, run(), signManifest(), trustPath, api, failNextMove (+28 more)

### Community 23 - "Repository Guidelines"
Cohesion: 0.22
Nodes (8): Build, Test, and Development Commands, Coding Style & Naming Conventions, Commit & Pull Request Guidelines, graphify, Project Structure & Module Organization, Repository Guidelines, Security & Configuration, Testing Guidelines

### Community 25 - "LoadMoreDirective"
Cohesion: 0.29
Nodes (3): @angular/core@^21.2.25, @angular/core, LoadMoreDirective

### Community 26 - "createAndSendNotification"
Cohesion: 0.22
Nodes (9): createAndSendNotification(), createNotification(), dispatchExpiryNotifications(), ensureExpiryNotifications(), isQuietHours(), notifyHouseholdShoppingChange(), pushConfiguration(), sendPushNotification() (+1 more)

### Community 28 - "CI Build Pipeline"
Cohesion: 0.22
Nodes (8): runs-on, jobs, build-and-test, signed-android-bundle, name, if, needs, runs-on

### Community 29 - "Android Signing Secrets"
Cohesion: 0.22
Nodes (9): ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, DEPLOY_HOST, DEPLOY_PORT, DEPLOY_SSH_KEY, DEPLOY_USER (+1 more)

### Community 30 - "Angular Bootstrap"
Cohesion: 0.43
Nodes (4): @angular/router@^21.2.25, @angular/router, appConfig, routes

### Community 31 - "vitest"
Cohesion: 0.40
Nodes (4): @angular/common@^21.2.25, vitest@^4.1.11, @angular/common, vitest

### Community 32 - "auth.mjs"
Cohesion: 0.31
Nodes (9): recipeAccount(), authenticate(), clearSessionCookie(), createSession(), hashPassword(), hashToken(), readSessionToken(), scrypt (+1 more)

### Community 34 - "@capacitor/cli"
Cohesion: 0.50
Nodes (3): config, @capacitor/cli@^7.6.0, @capacitor/cli

### Community 38 - "CI Cache Configuration"
Cohesion: 0.25
Nodes (8): with, cache, distribution, if-no-files-found, java-version, name, node-version, path

### Community 39 - "Live Update Tests"
Cohesion: 0.20
Nodes (6): manifest, pair, subtle, trust, UpdateManifest, verifyUpdateManifest()

### Community 41 - "CI Workflow Steps"
Cohesion: 0.43
Nodes (7): steps, steps, steps, name, run, uses, working-directory

### Community 42 - "Signed Android Bundle"
Cohesion: 0.29
Nodes (7): default, description, required, type, build_signed_aab, workflow_dispatch, inputs

### Community 43 - "Production Deployment Workflow"
Cohesion: 0.29
Nodes (7): cancel-in-progress, group, concurrency, if, needs, runs-on, deploy-production

### Community 44 - "Dependency Overrides"
Cohesion: 0.33
Nodes (6): piscina, overrides, @angular/build, effect, @prisma/config, deepmerge-ts

### Community 46 - "CI Branch Triggers"
Cohesion: 0.40
Nodes (5): on, pull_request, push, branches, branches

### Community 50 - "Android Splash Composition"
Cohesion: 0.67
Nodes (4): Android landscape HDPI resource, Blue geometric logo, Landscape Android splash screen, White background

### Community 55 - "Play Store Compliance"
Cohesion: 0.67
Nodes (3): Google Play release, Public account deletion page, Homie privacy policy

### Community 56 - "Production Migration Docs"
Cohesion: 0.67
Nodes (3): Production VPS migration, Homie application, Production deployment

## Knowledge Gaps
- **45 isolated node(s):** `Homie web application shell`, `Public account deletion page`, `Production VPS migration`, `Homie application`, `homie-web.app domain` (+40 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 284 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **67 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App` connect `Angular Application Logic` to `.compareFridgeItems`, `Touch Swipe Gestures`, `Recipe Domain Types`, `Shared Data Models`, `UI Mutation Workflows`, `Authentication and Onboarding`, `Notification Data Flow`, `Meal Planning`, `Recipe Picker Session`, `Recipe Catalog State`, `ShoppingItem`, `Frontend Component Tests`, `.runMutation`, `FridgeItem`, `Angular Bootstrap`?**
  _High betweenness centrality (0.257) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createApiServer()` (e.g. with `serializeDevUser()` and `serializeFridgeItem()`) actually correct?**
  _`createApiServer()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Homie web application shell`, `Public account deletion page`, `Production VPS migration` to the rest of the system?**
  _45 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Validation Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.05388471177944862 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `API Validation Layer` to `Capacitor Build Tooling`, `Package Dependencies`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Should `Angular Application Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.048265460030165915 - nodes in this community are weakly interconnected._
- **Why does `web-push` connect `Package Dependencies` to `API Validation Layer`, `Capacitor Build Tooling`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._