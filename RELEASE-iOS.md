# Shipping GALE to the iOS App Store

GALE is wrapped as a native iOS app with [Capacitor](https://capacitorjs.com):
the game is the same web build (`dist/`) running inside a full-screen WKWebView.
The Xcode project lives in `ios/`.

Everything that can be automated already is — including the archive, signing and
upload, which now run from **one command with no Xcode GUI**. What's left below
is the stuff that needs **your Apple Developer account**.

---

## What's already set up

- ✅ Native Xcode project (`ios/App/App.xcodeproj`), builds cleanly (Debug + Release).
- ✅ App name **GALE**, bundle id **`com.theonlyjason.gale`**.
- ✅ **Landscape-locked**, full screen, status bar hidden (`ios/App/App/Info.plist`).
- ✅ App icon + launch screen generated from the game art
  (`ios/App/App/Assets.xcassets/`).
- ✅ Safe-area (notch / Dynamic Island / home indicator) handled by the game HUD.
- ✅ Web-only AdSense is disabled inside the app (App Store policy — see step 6).
- ✅ Export compliance declared (`ITSAppUsesNonExemptEncryption = NO`) — no
  encryption questionnaire on uploads.
- ✅ Version `1.0`, build `1` (bump the build number for each re-upload).
- ✅ Performance pass: 15 audited+verified fixes (sprite caches, palette
  quantization, de-blurred trails, 120 Hz loop hoists, adaptive resolution)
  — the heaviest scene went from 16.6 ms to 2.5 ms per frame.
- ✅ **App Store screenshots** at required sizes in `store-screenshots/`
  (iPhone 6.9" 2868×1320 + iPad 13" 2752×2064, 5 each). Regenerate with
  `node scripts/store-shots.mjs` after art changes.
- ✅ **Privacy policy page** at `public/privacy.html` — deploy the site
  (`npm run deploy`) and use its URL in the listing.
- ✅ **Paste-ready listing copy** (name, subtitle, description, keywords,
  category, age rating, privacy answers) in `store-listing.md`.
- ✅ **One-command release pipeline**: `scripts/ios-release.sh` builds the web
  app, archives, signs via cloud signing and uploads to App Store Connect
  (`ios/App/ExportOptions.plist` holds the export settings).

---

## 1. Enroll in the Apple Developer Program (one time)

Enroll at <https://developer.apple.com/programs/enroll/> — **$99/year**. You'll
need your Apple ID and a payment method. Approval is usually quick (same day to
a couple of days).

## 2. Generate an App Store Connect API key (one time)

This key is what lets the release script (or Claude) sign and upload builds
without ever opening Xcode:

1. Sign in at <https://appstoreconnect.apple.com>.
2. Go to **Users and Access → Integrations → App Store Connect API → Team Keys**.
3. Click **＋** to generate a key with the **Admin** role.
4. **Download the `.p8` file** — this is a **one-time download**, so store it
   somewhere safe (e.g. `~/secrets/AuthKey_XXXXXXXXXX.p8`).
5. Note the **Key ID** (shown next to the key) and the **Issuer ID** (shown at
   the top of the Team Keys page).

## 3. Archive & upload — one command

Hand the key to Claude and ask for a release, or run it yourself:

```bash
ASC_KEY_ID=XXXXXXXXXX \
ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
ASC_KEY_PATH=~/secrets/AuthKey_XXXXXXXXXX.p8 \
./scripts/ios-release.sh
```

The script rebuilds the web app into the native shell (`npm run ios:sync`),
archives a Release build, signs it via Xcode cloud signing (the API key is
team-scoped, so no team or profile setup is needed), and uploads it straight to
App Store Connect. The build appears under your app in ~5–30 minutes once
Apple finishes processing.

Re-uploading? Bump the **build number** first (Xcode → App target → General →
Build, or `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`)
— App Store Connect rejects a build number it has already seen.

## 4. Finish the listing in App Store Connect

These remaining steps can be done **by Claude** (through the App Store Connect
API / browser) or by you, following `store-listing.md`:

- Create the app record: **Apps → ＋** — platform iOS, name **GALE**, bundle id
  `com.theonlyjason.gale`, primary language, category **Games**
  (e.g. Arcade / Action).
- Paste the listing copy (name, subtitle, description, keywords, support URL,
  **privacy policy URL** — required) from `store-listing.md`.
- Upload the screenshots from `store-screenshots/` (landscape; iPhone 6.9" and
  iPad 13" sets are already at the required sizes).
- Answer the **App Privacy** questionnaire (answers are in `store-listing.md`).
- Set the age rating, pricing (Free) and availability.
- Pick the processed build for the version and **Submit for Review**.

## 5. Test on a real device (recommended)

Plug in your iPhone, pick it as the run destination in Xcode
(`npm run ios` opens the project), press ▶. Confirm: landscape lock,
tap-and-hold to swing, DASH button, sound, no notch clipping.

## 6. Ads / privacy (only if you monetize)

The web build uses Google **AdSense**, which is **not allowed inside apps** and is
auto-disabled in the native build. To show ads in the app, integrate **AdMob**
(e.g. `@capacitor-community/admob`), then in App Store Connect's **App Privacy**:
- Declare data collection (AdMob collects identifiers).
- Add **App Tracking Transparency**: `NSUserTrackingUsageDescription` in Info.plist
  and show the ATT prompt before requesting a tracking-enabled ad.

If you ship **without** ads, the AdSense tag never loads in the app and you can
answer "no data collected" (verify against any analytics you add).

---

## Day-to-day: pushing web changes into the app

Any time you change the game code, refresh the native app with:

```bash
npm run ios:sync     # rebuild dist/ + copy into the iOS project
# then run from Xcode, or cut a release with ./scripts/ios-release.sh
```

(`ios-release.sh` runs `ios:sync` itself, so for a release the one command is
enough.)

Regenerate icons & launch screen after art changes:

```bash
npm run assets       # redraw source art + slice all iOS sizes
```
