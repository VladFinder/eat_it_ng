# Google Play release checklist

## What is in the repository

- Application ID: `space.eatit.app`.
- First release: version code `1`, version name `1.0`.
- Release command: `npm run android:aab`.
- The generated bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
- A signing keystore is never committed. Store it securely: the same key is required for every future update.
- Local Android builds require JDK 21 (or another JDK compatible with Android Gradle Plugin 8.7). A Java 8 JRE is not sufficient.
- The AAB command fails if release signing is absent or incomplete; it will not create an uploadable-looking unsigned bundle.

## One-time signing setup

1. Generate an upload key and keep a secure backup outside the repository:

```powershell
keytool -genkeypair -v -keystore android/upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

2. Copy `android/key.properties.example` to `android/key.properties` and enter the keystore path, alias, and passwords.
3. Run `npm run android:aab`. Before uploading, verify that the output is signed:

```powershell
cd android
./gradlew.bat signingReport
```

## CI signing setup

Add these GitHub Actions repository secrets before manually running the `CI` workflow with `build_signed_aab` enabled:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded contents of the `.jks` file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: alias used when the key was generated.
- `ANDROID_KEY_PASSWORD`: key password.

PowerShell can copy the value for the first secret with:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('android/upload-keystore.jks')) | Set-Clipboard
```

## Before publishing

- Create the Google Play Console application using package name `space.eatit.app`.
- Complete the store listing: name, short and full descriptions, 512x512 icon, feature graphic, and at least two current-phone screenshots.
- Publish a publicly accessible privacy-policy URL. The app collects an email address, account profile, household and food-list data, support messages, and auth tokens.
- Complete the Data safety form from the actual server-side retention, sharing, and deletion policy. Do not guess the answers.
- Provide an account-deletion path in the application or on a public web page. Play requires this for apps that let users create accounts.
- Test the signed AAB through an internal testing track on a physical Android device, including registration, login, logout, data changes, support, and an upgrade over the previous build.
- Confirm that `https://eat-it.space/api/health` and authentication are monitored and that database backups can be restored.

## Release procedure

1. Increase `versionCode` for every upload and update `versionName` in `android/app/build.gradle`.
2. Run `npm run build`, `npm run test:server`, and `npm run android:aab`.
3. Upload the signed `app-release.aab` to the internal testing track and complete Play's pre-launch report.
4. Promote the tested artifact to production in a staged rollout.
