# Myticket Inbox — iPhone & Android app

The app lives in the `mobile/` folder. It is a native shell (Capacitor 8) around the live inbox at
https://whatsapp.myticketom.com, so **every website update reaches the app immediately**, with no new
store upload. You only rebuild the app when something in `mobile/` changes (icon, name, permissions,
native plugins).

| | |
|---|---|
| App name | Myticket Inbox |
| App ID (bundle identifier) | `com.myticketom.inbox` |
| iPhone/iPad | private, via **TestFlight internal testing** |
| Android | private, via **Play Console internal testing** (or a direct APK) |

---

## 1. One-time setup on the Mac

1. Install **Xcode** from the Mac App Store, open it once and accept the licence.
2. Install **Android Studio** from https://developer.android.com/studio and open it once, so it
   downloads the Android SDK.
3. Install **Node.js 20 or newer** from https://nodejs.org.
4. Get the code and prepare the app:
   ```bash
   git clone https://github.com/wafakm6-netizen/myticket-shared-whatsapp-inbox.git
   cd myticket-shared-whatsapp-inbox/mobile
   npm install
   npx cap sync
   ```

---

## 2. iPhone & iPad (TestFlight, private)

### Accounts (once)
- **Apple Developer Program** ($99/year): https://developer.apple.com/programs/enroll/
  (enrolling as the company needs a free D-U-N-S number; this can take 1–2 weeks).
- In **App Store Connect** (https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**:
  - Platform: iOS · Name: **Myticket Inbox** · Bundle ID: **com.myticketom.inbox** · SKU: `myticket-inbox`
  - (If the bundle ID isn't in the list, first add it under
    developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs.)

### Build and upload
1. In the `mobile` folder run `npx cap open ios`. Xcode opens.
2. Click **App** in the left sidebar → **Signing & Capabilities** → tick **Automatically manage
   signing** → choose your **Team**.
3. On the **General** tab set **Version** (e.g. `1.0.0`) and **Build** (`1`; increase it for every upload).
4. At the top choose the device **Any iOS Device (arm64)**.
5. Menu **Product → Archive**. When it finishes, the Organizer opens → **Distribute App** →
   **TestFlight & App Store** → **Upload**.
6. After 5–15 minutes the build appears in App Store Connect → your app → **TestFlight**.

### Invite your team
1. App Store Connect → **Users and Access** → add each team member (role **Developer** or
   **Marketing** is enough).
2. Your app → **TestFlight** → **Internal Testing** → **+** create a group (e.g. "Myticket team") →
   add the members and the build.
3. Each person installs the **TestFlight** app from the App Store and accepts the invite email.

Internal testing has **no Apple review** and allows up to 100 people.

> **Important:** TestFlight builds stop working after **90 days**. Upload a new build (same steps,
> Build number +1) every couple of months — it only takes a few minutes.

---

## 3. Android (private)

### Option A — Play Console internal testing (recommended)
1. Create a **Google Play Console** account ($25 once): https://play.google.com/console/signup
2. **Create app** → name **Myticket Inbox** → App · Free.
3. In the `mobile` folder run `npx cap open android`. Android Studio opens (let Gradle finish).
4. Menu **Build → Generate Signed App Bundle or APK** → **Android App Bundle** → **Create new…**
   key store. **Keep the key store file and its passwords safe** — every future update must be
   signed with the same key.
5. Choose **release** → Create. The file is `android/app/release/app-release.aab`.
6. Play Console → your app → **Testing → Internal testing** → **Create new release** → upload the
   `.aab` → Save → **Review release** → **Start rollout**.
7. **Testers** tab → add your team's Gmail addresses → copy the **opt-in link** and send it to them.

### Option B — share the APK directly (no Play account)
In step 4 choose **APK** instead, then send `app-release.apk` to your team. On Android they open the
file and allow "Install unknown apps" once.

---

## 4. Updating the app

- **Website changes** (everything we've been building): nothing to do — the app shows them right away.
- **App changes** (`mobile/` folder): `git pull`, then in `mobile` run `npm install && npx cap sync`,
  and repeat the build/upload steps with a higher Build/version number.
- Changing the icon or splash: replace the images in `mobile/assets/` and run `npm run assets`.

---

## 5. Next step: native push notifications (phase 2)

Browser push doesn't work inside an app, so the app needs native notifications (lock-screen alerts,
sound and the app-icon badge). To add them, I'll need:

1. **Apple push key** — developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+** → tick
   **Apple Push Notifications service (APNs)** → download the `.p8` file and note the **Key ID**
   and your **Team ID**.
2. **Firebase project** (free) — https://console.firebase.google.com → Add project → add an **iOS
   app** (bundle ID `com.myticketom.inbox`) and an **Android app** (package `com.myticketom.inbox`).
   Download `GoogleService-Info.plist` and `google-services.json`, and upload the `.p8` key under
   Project settings → Cloud Messaging → Apple app configuration.
3. A Firebase **service account key** (Project settings → Service accounts → Generate new private
   key) so the inbox server can send the notifications.
