# Graph Report - eat_it_ng  (2026-10-28)

## Corpus Check
- 122 files · ~60,521 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 31 file(s) not represented in the graph (top: .xml 10, (none) 5, .example 2)

## Summary
- 871 nodes · 1643 edges · 102 communities (36 shown, 66 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

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
- Live Update System
- OAuth Authentication
- Database and Seeding
- Inventory Shopping Flow
- Android Instrumentation Tests
- Frontend Component Tests
- OTA Signing Pipeline
- Angular Shared Components
- Prisma Command Runner
- Server Entry and Admin
- CI Build Pipeline
- Android Signing Secrets
- Angular Bootstrap
- Swipe Browser Fixture
- Password and Token Auth
- Push Notification Delivery
- Server Integration Tests
- Live Update UI
- CI Cache Configuration
- Live Update Tests
- Recipe Suggestion Models
- CI Workflow Steps
- Signed Android Bundle
- Production Deployment Workflow
- Dependency Overrides
- Notification Data Flow
- CI Branch Triggers
- Meal Planning
- Developer User Management
- Android Splash Composition
- Recipe Translation Admin
- Android Main Activity
- Play Store Compliance
- Production Migration Docs
- Product Translation Admin
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
- `Production deployment` --references--> `Production VPS migration`  [EXTRACTED]
  README.md → docs/SERVER_MIGRATION.md
- `Google Play release` --publishes_url_for--> `Public account deletion page`  [EXTRACTED]
  docs/PLAY_RELEASE.md → public/delete-account.html
- `Google Play release` --publishes_url_for--> `Homie privacy policy`  [EXTRACTED]
  docs/PLAY_RELEASE.md → public/privacy.html
- `sendPushNotification()` --calls--> `isTrustedPushEndpoint()`  [EXTRACTED]
  server/app.mjs → server/validation.mjs
- `createApiServer()` --calls--> `authenticate()`  [EXTRACTED]
  server/app.mjs → server/auth.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Основной цикл управления домашним питанием** — src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_recipe_catalog, src_app_app_recipe_detail, src_app_app_meal_planner [INFERRED 0.95]
- **Основные разделы нижней навигации** — src_app_app_bottom_navigation, src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_random_recipe_picker, src_app_app_recipe_catalog, src_app_app_profile_hub [EXTRACTED 1.00]
- **Совместная работа участников дома** — src_app_app_household_group, src_app_app_notification_center, src_app_app_inventory_management, src_app_app_shopping_list, src_app_app_recipe_catalog [INFERRED 0.85]

## Communities (102 total, 66 thin omitted)

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
Nodes (6): ApiService, FeedbackItem, Household, NotificationPreferences, SupportMessage, SupportTicket

### Community 5 - "Package Dependencies"
Cohesion: 0.09
Nodes (32): dependencies, @angular/cdk@^21.2.14, @angular/compiler@^21.2.25, @angular/forms@^21.2.25, @angular/material@^21.2.14, @capacitor/android@^7.6.0, jose@^6.2.3, @ngrx/effects@^21.1.0 (+24 more)

### Community 6 - "Recipe Domain Types"
Cohesion: 0.09
Nodes (26): AuthMode, DevSection, DishIdea, FridgeSort, FridgeStatusFilter, LEGACY_DEMO_RECIPE_TITLES, ONBOARDING_STEPS, OnboardingStep (+18 more)

### Community 7 - "Shared Data Models"
Cohesion: 0.11
Nodes (12): AppState, AuthProviders, AuthResponse, DevSummary, FridgeInput, FridgeItem, HouseholdSubscription, ItemCategory (+4 more)

### Community 9 - "Dish Matching Logic"
Cohesion: 0.19
Nodes (21): addMissingDishIngredientsToShopping(), canonicalIngredientName(), ensureCatalogLocalized(), formatIngredient(), fridgeItemIsExpiring(), importRecipeSuggestions(), ingredientEnding(), matchedDishSuggestions() (+13 more)

### Community 11 - "Project Scripts"
Cohesion: 0.10
Nodes (20): scripts, admin:grant, android:aab, android:apk, android:sync, build, db:generate, db:migrate (+12 more)

### Community 12 - "Capacitor Build Tooling"
Cohesion: 0.11
Nodes (18): config, devDependencies, @angular/build@^21.2.24, @angular/cli@^21.2.24, @angular/compiler-cli@^21.2.25, @capacitor/cli@^7.6.0, jsdom@^28.0.0, prettier@^3.8.1 (+10 more)

### Community 13 - "Main Application Interface"
Cohesion: 0.19
Nodes (19): Удаление аккаунта, Аутентификация и регистрация, Главная нижняя навигация, Административный Dev center, Обратная связь об идеях и ошибках, Подписка Homie Plus, Общий дом и участники, Управление домашними запасами (+11 more)

### Community 14 - "Recipe Catalog Integration"
Cohesion: 0.22
Nodes (17): catalogPageKey(), fetchCatalogPage(), fetchPopularRecipeSuggestions(), fetchRecipeInformationBulk(), fetchRecipeSuggestions(), loadCatalogPage(), plainText(), recipeSteps() (+9 more)

### Community 15 - "Live Update System"
Cohesion: 0.18
Nodes (11): @capacitor/core@^7.6.0, @capgo/capacitor-updater@7.51.23, @capacitor/core, @capgo/capacitor-updater, UpdateManifest, verifyUpdateManifest(), bundle, manifest (+3 more)

### Community 16 - "OAuth Authentication"
Cohesion: 0.21
Nodes (14): appleAuthorization(), appleClientSecret(), appleKeys, baseUrl(), challenge(), clearOauthCookie(), cookieValue(), exchangeAppleCode() (+6 more)

### Community 19 - "Database and Seeding"
Cohesion: 0.27
Nodes (11): columnsFor(), defaultDatabasePath, ensureColumn(), ensureDatabaseSchema(), ensureTable(), normalizeProductName(), nowIso(), prisma (+3 more)

### Community 23 - "OTA Signing Pipeline"
Cohesion: 0.29
Nodes (6): main(), nativeFingerprint(), root, run(), signManifest(), trustPath

### Community 25 - "Angular Shared Components"
Cohesion: 0.20
Nodes (5): @angular/common@^21.2.25, @angular/core@^21.2.25, @angular/common, @angular/core, LoadMoreDirective

### Community 26 - "Prisma Command Runner"
Cohesion: 0.22
Nodes (5): result, databasePath, prismaCli, projectRoot, result

### Community 27 - "Server Entry and Admin"
Cohesion: 0.20
Nodes (5): email, envPath, expiryNotificationTimer, port, server

### Community 28 - "CI Build Pipeline"
Cohesion: 0.22
Nodes (8): runs-on, jobs, build-and-test, signed-android-bundle, name, if, needs, runs-on

### Community 29 - "Android Signing Secrets"
Cohesion: 0.22
Nodes (9): ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, DEPLOY_HOST, DEPLOY_PORT, DEPLOY_SSH_KEY, DEPLOY_USER (+1 more)

### Community 30 - "Angular Bootstrap"
Cohesion: 0.31
Nodes (6): @angular/platform-browser@^21.2.25, @angular/router@^21.2.25, @angular/platform-browser, @angular/router, appConfig, routes

### Community 31 - "Swipe Browser Fixture"
Cohesion: 0.22
Nodes (7): api, failNextMove, fridgeItems, mime, root, server, user

### Community 32 - "Password and Token Auth"
Cohesion: 0.33
Nodes (7): authenticate(), clearSessionCookie(), hashPassword(), hashToken(), readSessionToken(), scrypt, verifyPassword()

### Community 33 - "Push Notification Delivery"
Cohesion: 0.22
Nodes (9): createAndSendNotification(), createNotification(), dispatchExpiryNotifications(), ensureExpiryNotifications(), isQuietHours(), notifyHouseholdShoppingChange(), pushConfiguration(), sendPushNotification() (+1 more)

### Community 34 - "Server Integration Tests"
Cohesion: 0.25
Nodes (4): databasePath, projectRoot, recipeAccount(), createSession()

### Community 38 - "CI Cache Configuration"
Cohesion: 0.25
Nodes (8): with, cache, distribution, if-no-files-found, java-version, name, node-version, path

### Community 39 - "Live Update Tests"
Cohesion: 0.25
Nodes (6): vitest@^4.1.11, vitest, manifest, pair, subtle, trust

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
- **45 isolated node(s):** `Homie application`, `homie-web.app domain`, `Signed Android OTA updates`, `Stable beta v0.3`, `Production VPS migration` (+40 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 275 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **66 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App` connect `Angular Application Logic` to `Household State Sync`, `Touch Swipe Gestures`, `Recipe Domain Types`, `Shared Data Models`, `UI Mutation Workflows`, `Authentication and Onboarding`, `Notification Data Flow`, `Inventory Sorting Logic`, `Meal Planning`, `Recipe Picker Session`, `Recipe Catalog State`, `Inventory Shopping Flow`, `Fridge Item Actions`, `Frontend Component Tests`, `Developer Center Workflows`, `Angular Bootstrap`?**
  _High betweenness centrality (0.262) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `createApiServer()` (e.g. with `serializeDevUser()` and `serializeFridgeItem()`) actually correct?**
  _`createApiServer()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Homie application`, `homie-web.app domain`, `Signed Android OTA updates` to the rest of the system?**
  _45 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `API Validation Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.05388471177944862 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `API Validation Layer` to `Package Dependencies`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Should `Angular Application Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.04716981132075472 - nodes in this community are weakly interconnected._
- **Why does `web-push` connect `Package Dependencies` to `API Validation Layer`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._