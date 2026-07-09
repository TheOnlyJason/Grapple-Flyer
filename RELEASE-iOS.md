# Shipping GALE to the iOS App Store

GALE is wrapped as a native iOS app with [Capacitor](https://capacitorjs.com):
the game is the same web build (`dist/`) running inside a full-screen WKWebView.
The Xcode project lives in `ios/`.

Everything that can be automated already is. What's left below is the stuff that
needs **your Apple Developer account** and Xcode's UI.

---

## What's already set up

- ✅ Native Xcode project (`ios/App/App.xcodeproj`), builds cleanly (Debug + Release).
- ✅ App name **GALE**, bundle id **`com.gale.skysailing`** _(placeholder — change it, see step 1)_.
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

## Prerequisites (one time)

- **Apple Developer Program** membership — $99/year: <https://developer.apple.com/programs/>
- Xcode (installed) + a physical iPhone for real-device testing.

---

## 1. Set your bundle identifier

`com.gale.skysailing` is a placeholder. Pick your own reverse-domain id and set it in **two** places:

1. `capacitor.config.ts` → `appId`
2. Xcode → **App** target → **Signing & Capabilities** → **Bundle Identifier**

Then register that exact id at
<https://developer.apple.com/account/resources/identifiers/list>.

## 2. Signing

Open the project and let Xcode manage signing:

```bash
npm run ios      # builds web, syncs, opens Xcode
```

In Xcode → **App** target → **Signing & Capabilities**:
- Check **Automatically manage signing**
- Select your **Team**

## 3. Version & build number

Xcode → **App** target → **General**:
- **Version** (e.g. `1.0.0`) — the public version.
- **Build** (e.g. `1`) — must increase for every upload to App Store Connect.

## 4. Test on a real device

Plug in your iPhone, pick it as the run destination in Xcode, press ▶. Confirm:
landscape lock, tap-and-hold to swing, DASH button, sound, no notch clipping.

## 5. Create the App Store Connect listing

At <https://appstoreconnect.apple.com> → **Apps** → **＋**:
- Platform iOS, name **GALE**, your bundle id, primary language.
- Category: **Games** (e.g. Arcade / Action).
- **Screenshots** — landscape, required sizes: 6.7"/6.9" iPhone, and iPad if you
  support it. Capture from a device or simulator (`⌘S` in the Simulator).
- Description, keywords, support URL, **privacy policy URL** (required).
- Age rating questionnaire, pricing (Free), availability.

## 6. Ads / privacy (only if you monetize)

The web build uses Google **AdSense**, which is **not allowed inside apps** and is
auto-disabled in the native build. To show ads in the app, integrate **AdMob**
(e.g. `@capacitor-community/admob`), then in App Store Connect's **App Privacy**:
- Declare data collection (AdMob collects identifiers).
- Add **App Tracking Transparency**: `NSUserTrackingUsageDescription` in Info.plist
  and show the ATT prompt before requesting a tracking-enabled ad.

If you ship **without** ads, the AdSense tag never loads in the app and you can
answer "no data collected" (verify against any analytics you add).

## 7. Archive & upload

In Xcode:
1. Set the run destination to **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. In the Organizer: **Distribute App → App Store Connect → Upload**.

The build appears in App Store Connect after processing. Attach it to your version,
fill remaining metadata, and **Submit for Review**.

---

## Day-to-day: pushing web changes into the app

Any time you change the game code, refresh the native app with:

```bash
npm run ios:sync     # rebuild dist/ + copy into the iOS project
# then run/archive from Xcode
```

Regenerate icons & launch screen after art changes:

```bash
npm run assets       # redraw source art + slice all iOS sizes
```
