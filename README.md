# EatItNg

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.9.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

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

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

## Production deployment

Pushes to `main` are deployed to
`/var/www/eat-it/dist/eat_it_ng/browser` after the build and tests pass. The
GitHub repository must contain these Actions secrets:

- `DEPLOY_HOST`: `94.103.13.116`
- `DEPLOY_USER`: the unprivileged SSH deployment user
- `DEPLOY_SSH_PRIVATE_KEY`: the private SSH key used by GitHub Actions
- `DEPLOY_SSH_KNOWN_HOSTS`: the server host key from `ssh-keyscan 94.103.13.116`

The server must have Nginx and rsync installed. Its Nginx virtual host is
provided in `deploy/nginx-eat-it.space.conf`.

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
