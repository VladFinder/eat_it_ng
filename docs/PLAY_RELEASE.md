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
- Publish the privacy-policy URL `https://eat-it.space/privacy.html` in Play Console. The app collects an email address, account profile, household and food-list data, support messages, and auth tokens.
- Complete the Data safety form from the actual server-side retention, sharing, and deletion policy. Do not guess the answers.
- Enter `https://eat-it.space/delete-account.html` as the external account-deletion URL in Play Console. The same deletion path is available in the application profile.
- Test the signed AAB through an internal testing track on a physical Android device, including registration, login, logout, data changes, support, and an upgrade over the previous build.
- Confirm that `https://eat-it.space/api/health` and authentication are monitored and that database backups can be restored.

## Release procedure

1. Increase `versionCode` for every upload and update `versionName` in `android/app/build.gradle`.
2. Run `npm run build`, `npm run test:server`, and `npm run android:aab`.
3. Upload the signed `app-release.aab` to the internal testing track and complete Play's pre-launch report.
4. Promote the tested artifact to production in a staged rollout.

## Final release gate

- Confirm that `versionCode` has never been uploaded for this application ID. `1` is valid only for the first Play upload.
- Confirm the signing key is backed up outside the repository and that the four Android signing secrets are configured in GitHub Actions.
- Open both public URLs from a logged-out browser and complete account deletion using a test account.
- Confirm that production backup retention is no longer than the 30 days stated in the privacy policy.
- Complete store listing, App content, Data safety, Data deletion, content rating, and target audience in Play Console.
