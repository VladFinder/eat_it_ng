# Google Play release checklist

## What is in the repository

- Application ID: `space.eatit.app`.
- Current release: version code `4`, version name `2.0.2` (OTA runtime `2.0.2`).
- Minimum supported Android version: Android 7.0 (API 24), required for Google Play automatic protection.
- Release command: `npm run android:aab`.
- The generated bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
- A signing keystore is never committed. Store it securely: the same key is required for every future update.
- Local Android builds require JDK 21 and Android SDK 36 (Android Gradle Plugin 8.10.1). A Java 8 JRE is not sufficient.
- The AAB command fails if release signing is absent or incomplete; it will not create an uploadable-looking unsigned bundle.

## Changes in 2.0.2

- Raise the minimum Android SDK from 23 to 24 for Google Play automatic protection.
- Increment the Play upload version code to 4 and isolate compatible OTA updates under runtime 2.0.2.

## Changes in 2.0.1

- Profile → About the app shows the installed APK version and the active OTA version. The bundled web interface is identified separately from a downloaded update.
- Browser favicons and the iPhone Home Screen icon use the selected Homie Play Store artwork.
- Native compatibility checks ignore Capacitor's generated `res/xml/config.xml`, whose source configuration is already included in the fingerprint. A clean checkout and a synced checkout produce the same fingerprint.

## Security configuration for this release

- Deploy the updated API together with the app. Security fixes are in `server/`, not in the Android bundle.
- Password registration never grants administrator access based on email. For an existing trusted password account, set `ADMIN_USER_IDS` to its database user ID. Do not infer that ID from a newly registered email. Verified Google/Apple accounts can use `ADMIN_EMAILS` (the two existing owner emails are still included).
- On the first verified OAuth sign-in for an existing password account, the API revokes its old sessions and removes the unverified password. Subsequent sign-in uses that OAuth provider.
- Set `TRUST_PROXY=true` only with the local nginx configuration that overwrites `X-Real-IP`. This lets authentication rate limits distinguish clients behind the proxy.
- Push endpoints are restricted to HTTPS browser push providers. Native OAuth return handling and native push delivery still require device validation; a successful web build does not validate them.
- Recipe preferences and dismissed notifications are stored per account. The old shared recipe cache is no longer loaded because it cannot be attributed safely to one user.

## One-time signing setup

The npm APK/AAB commands work on Windows, macOS and Linux. On macOS/Linux, run manual Gradle commands as `sh gradlew` from the Android directory (for example, `cd android` then `sh gradlew signingReport`).

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
- Publish the privacy-policy URL `https://homie-web.app/privacy.html` in Play Console. The app collects an email address, account profile, household and food-list data, support messages, and auth tokens.
- Complete the Data safety form from the actual server-side retention, sharing, and deletion policy. Do not guess the answers.
- Enter `https://homie-web.app/delete-account.html` as the external account-deletion URL in Play Console. The same deletion path is available in the application profile.
- Test the signed AAB through an internal testing track on a physical Android device, including registration, login, logout, data changes, support, and an upgrade over the previous build.
- Confirm that `https://homie-web.app/api/health` and authentication are monitored and that database backups can be restored.

## Release procedure

1. Increase `versionCode` for every upload and update `versionName` in `android/app/build.gradle`.
2. Run `npm run build`, `npm test -- --watch=false`, `npm run test:server`, and `npm run android:aab`.
3. Upload the signed `app-release.aab` to the internal testing track and complete Play's pre-launch report.
4. Promote the tested artifact to production in a staged rollout.

## Final release gate

- Confirm that `versionCode` has never been uploaded for this application ID. `1` is valid only for the first Play upload.
- Confirm the signing key is backed up outside the repository and that the four Android signing secrets are configured in GitHub Actions.
- Open both public URLs from a logged-out browser and complete account deletion using a test account.
- Confirm that production backup retention is no longer than the 30 days stated in the privacy policy.
- Complete store listing, App content, Data safety, Data deletion, content rating, and target audience in Play Console.
