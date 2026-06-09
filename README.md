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
stores one shared anonymous household. Do not expose it as a public multi-user
service until authentication and household isolation are implemented.

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
sudo -u www-data npm run db:migrate
npm run build -- --configuration production
rsync -a --delete dist/eat_it_ng/browser/ /var/www/eat-it/dist/eat_it_ng/browser/
sudo chown -R www-data:www-data /opt/eat-it/app/data
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
