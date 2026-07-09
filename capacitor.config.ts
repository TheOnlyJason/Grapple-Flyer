import type { CapacitorConfig } from "@capacitor/cli";

// NOTE: `appId` is the iOS bundle identifier. Change it to one you own /
// register in your Apple Developer account BEFORE you archive for the App
// Store (e.g. com.yourname.gale). After changing it here, also update it in
// Xcode (App target ▸ Signing & Capabilities ▸ Bundle Identifier), or re-run
// `npx cap add ios`.
const config: CapacitorConfig = {
  appId: "com.gale.skysailing",
  appName: "GALE",
  webDir: "dist",
  backgroundColor: "#0a0d24",
  ios: {
    // The game paints its own full-bleed canvas; never inset or scroll it.
    contentInset: "never",
    scrollEnabled: false,
    backgroundColor: "#0a0d24",
  },
};

export default config;
