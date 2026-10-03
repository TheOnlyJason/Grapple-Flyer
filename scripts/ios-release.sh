#!/usr/bin/env bash
# ios-release.sh — build, archive, sign (cloud) and upload GALE to App Store Connect.
#
# One command, no Xcode GUI. Requires an App Store Connect API key:
#
#   ASC_KEY_ID=ABC123DEF4 \
#   ASC_ISSUER_ID=12345678-1234-1234-1234-123456789abc \
#   ASC_KEY_PATH=/path/to/AuthKey_ABC123DEF4.p8 \
#   ./scripts/ios-release.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  echo "Usage: ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id> ASC_KEY_PATH=<path to .p8> $0" >&2
  echo "" >&2
  echo "  ASC_KEY_ID     App Store Connect API Key ID (e.g. ABC123DEF4)" >&2
  echo "  ASC_ISSUER_ID  App Store Connect Issuer ID (UUID)" >&2
  echo "  ASC_KEY_PATH   Path to the downloaded AuthKey_<KEY_ID>.p8 file" >&2
  echo "" >&2
  echo "Generate a key: App Store Connect -> Users and Access -> Integrations" >&2
  echo "  -> App Store Connect API -> Team Keys (role: Admin)." >&2
}

if [[ -z "${ASC_KEY_ID:-}" || -z "${ASC_ISSUER_ID:-}" || -z "${ASC_KEY_PATH:-}" ]]; then
  echo "Error: ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH must all be set." >&2
  echo "" >&2
  usage
  exit 1
fi

if [[ ! -f "$ASC_KEY_PATH" ]]; then
  echo "Error: .p8 key not found at: $ASC_KEY_PATH" >&2
  echo "" >&2
  usage
  exit 1
fi

echo ""
echo "==> [1/3] Building web app and syncing into the native shell"
npm run ios:sync

echo ""
echo "==> [2/3] Archiving Release build (cloud signing via App Store Connect API key)"
LANG=en_US.UTF-8 xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/GALE.xcarchive \
  ${ASC_TEAM_ID:+DEVELOPMENT_TEAM="$ASC_TEAM_ID"} \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo ""
echo "==> [3/3] Exporting archive and uploading to App Store Connect"
LANG=en_US.UTF-8 xcodebuild -exportArchive \
  -archivePath build/GALE.xcarchive \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo ""
echo "==> Done. The build was uploaded and is now processing in App Store Connect."
echo "    It will appear under TestFlight / your app's Builds in ~5-30 minutes,"
echo "    then you can attach it to a version and submit for review."
