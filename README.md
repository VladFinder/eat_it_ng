# EatItNg

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.9.

## Local development

Install dependencies, create the SQLite database, and seed demo data:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
```

Start the API:

```bash
npm run start:api
```

In another terminal, start Angular:

```bash
npm start
```

Open `http://localhost:4200/`. Angular proxies `/api` requests to
`http://127.0.0.1:3000`.

The local SQLite database is stored in `data/eat-it.db`. The API currently
stores fridge and shopping data per account household.

## Authentication

Email/password registration works without external services. Passwords are
hashed with Node.js `scrypt`; session tokens are random, and only their SHA-256
hashes are stored in the database.

Google and Apple buttons appear only when their server credentials are set in
`/opt/eat-it/app/.env`.

Recipe suggestions use the Spoonacular API. Keep the key on the API server:

```dotenv
SPOONACULAR_API_KEY="..."
```

To localize Spoonacular titles, ingredients, descriptions, and instructions,
configure Yandex Translate. Translations are cached in SQLite and reused:

```dotenv
YANDEX_TRANSLATE_API_KEY="..."
```

Use a service-account API key with the `yc.ai.translate.execute` scope and the
`ai.translate.user` role on its folder. Do not send `folderId` with this authentication
method: Yandex selects the service account's folder automatically
([authentication documentation](https://aistudio.yandex.ru/en/docs/translate/api-ref/authentication)).
The legacy `YANDEX_TRANSLATE_FOLDER_ID` setting is ignored.

If Yandex Translate is not configured or temporarily fails, recipes remain
available in their original language. Saved catalog recipes are translated when
read, including recipe details and random picks; household recipes are left as entered.
Cached translations remain available without a configured key. Failed translations
are retried on the next request, so reimporting the catalog is unnecessary.

The **Рецепты** tab opens a general Spoonacular catalog independent of fridge contents.
`GET /api/recipes/catalog?query=&offset=0&source=auto` returns 20 recipes, a `nextOffset`
(or `null` at the end), and the pagination source (`remote` or `local`). The UI appends
pages on scroll, debounces search by 350 ms, and ignores superseded responses. Russian
queries are translated to English with Yandex and cached separately from recipe translations.
Availability labels still reflect household stock, while the catalog preserves provider order.

Spoonacular limits search offsets to 900; when this window is exhausted, the UI suggests
refining the search instead of claiming the entire provider database has ended. Requests
also consume the provider's quota. Pages are cached for six hours (up to 100 pages per API
process). If the first page cannot be fetched, the API searches and paginates saved recipes;
a failed later page remains retryable without changing the feed or skipping recipes.
See the [provider documentation](https://spoonacular.com/food-api/docs#Search-Recipes-Complex).

The **Рецепты** tab also provides favorites and household recipes.
Household recipes support ingredients, preparation steps, optional time, description,
and image URL. Available ingredients have green labels; missing ingredients have red labels.
Weekly meal plans remain available to households with existing Plus access.

The **Подобрать** tab replaces the old dishes tab. It picks a random saved recipe
using only available ingredients or allowing up to 1, 2, or 3 missing ingredients,
with optional favorites or household filters. The animated die respects reduced motion.
Ingredient matching uses `GET /api/recipes/matches` without external recipe API calls;
editing uses `PATCH /api/dishes/:id` and preserves recipe IDs and meal plan references.
Deploy the updated API together with the web/Android client. These changes require no
database migration. Public subscription purchasing remains marked **Скоро**.

Web Push requires one VAPID key pair. Generate it once:

```bash
npm run push:generate-keys
```

Store the generated keys in `/opt/eat-it/app/.env` and keep the private key secret:

```dotenv
VAPID_SUBJECT="mailto:support@eat-it.space"
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
```

Restart `eat-it-api` after changing these values. On iPhone, Web Push is available
on iOS 16.4 or later only after the user adds Homie to the Home Screen and launches
that installed web app.

Google OAuth variables:

```dotenv
APP_URL="https://eat-it.space"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
```

Register this redirect URI in Google Cloud Console:

```text
https://eat-it.space/api/auth/google/callback
```

Apple OAuth variables:

```dotenv
APP_URL="https://eat-it.space"
APPLE_CLIENT_ID="your.services.id"
APPLE_TEAM_ID="..."
APPLE_KEY_ID="..."
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Register this return URL for the Apple Services ID:

```text
https://eat-it.space/api/auth/apple/callback
```

Apple requires an HTTPS domain, a Services ID associated with a Sign in with
Apple-enabled App ID, and a private key. Restart `eat-it-api` after changing
`.env`.

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

Run backend integration tests:

```bash
npm run test:server
```

## Production deployment

GitHub Actions checks the production build and tests, then publishes two
downloadable artifacts:

- `eat-it-web`: the contents of `dist/eat_it_ng/browser`;
- `eat-it-debug-apk`: the Android debug APK.

Deployment to the web server is manual. The server needs Git, Node.js 20+,
npm, Nginx, rsync, and systemd.

For a full server migration checklist, including data copy, DNS switch, HTTPS,
and rollback, see `docs/SERVER_MIGRATION.md`.

For the first deployment:

```bash
sudo mkdir -p /opt/eat-it /var/www/eat-it/dist/eat_it_ng/browser
sudo chown -R "$USER":"$USER" /opt/eat-it /var/www/eat-it
git clone https://github.com/VladFinder/eat_it_ng.git /opt/eat-it/app
cd /opt/eat-it/app
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run build -- --configuration production
rsync -a --delete dist/eat_it_ng/browser/ /var/www/eat-it/dist/eat_it_ng/browser/
sudo chown -R www-data:www-data /opt/eat-it/app/data
```

Install and start the API service:

```bash
sudo cp /opt/eat-it/app/deploy/eat-it-api.service /etc/systemd/system/eat-it-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now eat-it-api
curl http://127.0.0.1:3010/api/health
```

Install the provided Nginx virtual host, which serves Angular and proxies
`/api` to Node.js:

```bash
sudo cp /opt/eat-it/app/deploy/nginx-eat-it.space.conf /etc/nginx/sites-available/eat-it.space
sudo ln -s /etc/nginx/sites-available/eat-it.space /etc/nginx/sites-enabled/eat-it.space
sudo nginx -t
sudo systemctl reload nginx
```

For every later release:

```bash
cd /opt/eat-it/app
git pull --ff-only origin main
npm ci
npm run db:generate
npm run build -- --configuration production
rsync -a --delete dist/eat_it_ng/browser/ /var/www/eat-it/dist/eat_it_ng/browser/
sudo chown -R www-data:www-data /opt/eat-it/app/data
sudo systemctl restart eat-it-api
```

The `eat-it-api` systemd unit runs `npm run db:migrate` before starting the API.
After changing `deploy/eat-it-api.service`, copy it again and reload systemd:

```bash
sudo cp /opt/eat-it/app/deploy/eat-it-api.service /etc/systemd/system/eat-it-api.service
sudo systemctl daemon-reload
sudo systemctl restart eat-it-api
```

The Nginx virtual host is provided in `deploy/nginx-eat-it.space.conf`.
The Android build uses `https://eat-it.space/api`, so HTTPS must be configured
before testing synchronization from an APK.

The implementation stages are tracked in `docs/ROADMAP.md`.

## Android APK

The Android application uses Capacitor with application ID `space.eatit.app`.

To synchronize the production web build with Android:

```bash
npm run android:sync
```

On Windows with Android Studio, JDK 21, and the Android SDK installed:

```bash
npm run android:apk
```

The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.
GitHub Actions also publishes it as the `eat-it-debug-apk` artifact after a
successful CI run.
