# Myticket Inbox – iOS (TestFlight)

A Capacitor shell that loads the deployed web app (`APP_URL`, default
`https://whatsapp.myticketom.com`). The Xcode project is generated in CI, so
nothing iOS-specific is committed except this folder.

## One-time setup (Apple side)

1. Apple Developer account -> Identifiers -> register the App ID `com.myticketom.inbox`
   (or choose another and set repo variable `IOS_BUNDLE_ID`).
2. App Store Connect -> My Apps -> New App -> same Bundle ID, name "Myticket Inbox".
3. App Store Connect -> Users and Access -> Integrations -> create an API key
   (role: App Manager). Download the `.p8` once.
4. GitHub repo -> Settings -> Secrets and variables -> Actions, add:
   - `APPLE_TEAM_ID`
   - `ASC_KEY_ID`
   - `ASC_ISSUER_ID`
   - `ASC_KEY_P8` (the full text of the `.p8` file, pasted as-is)

## Build and upload

GitHub -> Actions -> **iOS TestFlight** -> Run workflow. The build number is the
workflow run number. After processing (~10-30 min) the build appears in
TestFlight; add internal testers there.

## Known gaps before wider release

- **Push notifications** still use Web Push (`public/myticket-push-sw.js`), which
  does not work inside a native shell. Needs the Push Notifications capability,
  an APNs key, and a device-token endpoint on the server.
- **App Review (guideline 4.2)**: a pure web wrapper can be rejected for public
  release. Internal TestFlight testing is not affected.
- Icon is upscaled from the 512px brand icon; replace `assets/icon-only.png` and
  `assets/icon-foreground.png` with a true 1024x1024 file.
