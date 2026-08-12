#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
APP_DIR="$REPO_ROOT/apps/swift-ios"
CHANNEL="${1:-}"
TEAM="${T3_SWIFT_DEVELOPMENT_TEAM:-}"
DEVICE_ID="${T3_SWIFT_DEVICE_ID:-}"
ARTIFACT_ROOT="${T3_SWIFT_ARTIFACT_ROOT:-$HOME/.t3/artifacts/swiftui-stream}"

case "$CHANNEL" in
  dev)
    CONFIGURATION=Dev
    SCHEME=T3CodeDev
    BUNDLE_ID=com.saphid.t3code.swiftui.stream.dev
    EXPECTED_BRANCH=personal/swiftui-dev
    ;;
  test)
    CONFIGURATION=Test
    SCHEME=T3CodeTest
    BUNDLE_ID=com.saphid.t3code.swiftui.stream.test
    EXPECTED_BRANCH=personal/swiftui-test
    ;;
  *) printf 'usage: %s dev|test\n' "$0" >&2; exit 2 ;;
esac

[[ -n "$TEAM" ]] || { echo "T3_SWIFT_DEVELOPMENT_TEAM is required" >&2; exit 1; }
[[ -n "$DEVICE_ID" ]] || { echo "T3_SWIFT_DEVICE_ID is required" >&2; exit 1; }
"$SCRIPT_DIR/stream.py" validate
[[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] || {
  echo "refusing to publish a non-reproducible dirty build" >&2
  exit 1
}
BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
[[ "$BRANCH" == "$EXPECTED_BRANCH" ]] || {
  echo "$CHANNEL builds must be published from $EXPECTED_BRANCH, not $BRANCH" >&2
  exit 1
}

if [[ -n "${T3_SWIFT_BUILD_NUMBER:-}" ]]; then
  BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL" --requested "$T3_SWIFT_BUILD_NUMBER")"
else
  BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL")"
fi
COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
DERIVED="${T3_SWIFT_DERIVED_DATA_PATH:-$APP_DIR/.derivedData/ready-$CHANNEL}"
DESTINATION="platform=iOS,id=$DEVICE_ID"

xcodebuild build \
  -quiet \
  -project "$APP_DIR/T3Code.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  "DEVELOPMENT_TEAM=$TEAM" \
  "CURRENT_PROJECT_VERSION=$BUILD" \
  "T3_GIT_COMMIT=$COMMIT" \
  "T3_GIT_REPO_URL=https://github.com/saphid/t3code-personal" \
  "T3_GIT_BASE_REF=upstream/t3code/rebuild-mobile-app-swift"

APP_PATH="$DERIVED/Build/Products/$CONFIGURATION-iphoneos/T3Code.app"
[[ -d "$APP_PATH" ]] || { echo "missing built app: $APP_PATH" >&2; exit 1; }
ACTUAL_BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
ACTUAL_BUILD="$(plutil -extract CFBundleVersion raw -o - "$APP_PATH/Info.plist")"
ACTUAL_CHANNEL="$(plutil -extract T3BuildChannel raw -o - "$APP_PATH/Info.plist")"
ACTUAL_COMMIT="$(plutil -extract T3GitCommit raw -o - "$APP_PATH/Info.plist")"
[[ "$ACTUAL_BUNDLE" == "$BUNDLE_ID" ]] || { echo "unexpected bundle $ACTUAL_BUNDLE" >&2; exit 1; }
[[ "$ACTUAL_BUILD" == "$BUILD" ]] || { echo "unexpected build $ACTUAL_BUILD" >&2; exit 1; }
[[ "$ACTUAL_CHANNEL" == "$CHANNEL" ]] || { echo "unexpected channel $ACTUAL_CHANNEL" >&2; exit 1; }
[[ "$ACTUAL_COMMIT" == "$COMMIT" ]] || { echo "unexpected commit $ACTUAL_COMMIT" >&2; exit 1; }
codesign --verify --deep --strict "$APP_PATH"
WIDGET_PATH="$APP_PATH/PlugIns/T3CodeWidgets.appex"
SHARE_PATH="$APP_PATH/PlugIns/T3CodeShare.appex"
for EXTENSION_PATH in "$WIDGET_PATH" "$SHARE_PATH"; do
  [[ -d "$EXTENSION_PATH" ]] || { echo "missing extension $EXTENSION_PATH" >&2; exit 1; }
  codesign --verify --strict "$EXTENSION_PATH"
done
WIDGET_BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$WIDGET_PATH/Info.plist")"
SHARE_BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$SHARE_PATH/Info.plist")"
[[ "$WIDGET_BUNDLE" == "$BUNDLE_ID.widgets" ]] || { echo "unexpected widget bundle $WIDGET_BUNDLE" >&2; exit 1; }
[[ "$SHARE_BUNDLE" == "$BUNDLE_ID.sharing" ]] || { echo "unexpected share bundle $SHARE_BUNDLE" >&2; exit 1; }

ARTIFACT_DIR="$ARTIFACT_ROOT/$CHANNEL/$BUILD-$COMMIT"
mkdir -p "$ARTIFACT_DIR"
ditto "$APP_PATH" "$ARTIFACT_DIR/T3Code.app"
ditto -c -k --sequesterRsrc --keepParent "$ARTIFACT_DIR/T3Code.app" "$ARTIFACT_DIR/T3Code.app.zip"
SHA256="$(shasum -a 256 "$ARTIFACT_DIR/T3Code.app.zip" | awk '{print $1}')"
POINTER_DIR="$HOME/.t3/swiftui-stream/ready"
mkdir -p "$POINTER_DIR"
POINTER_TMP="$(mktemp "$POINTER_DIR/$CHANNEL.XXXXXX")"
jq -n \
  --arg channel "$CHANNEL" \
  --argjson build "$BUILD" \
  --argjson sequence "$BUILD" \
  --arg commit "$COMMIT" \
  --arg bundleId "$BUNDLE_ID" \
  --arg appPath "$ARTIFACT_DIR/T3Code.app" \
  --arg zipPath "$ARTIFACT_DIR/T3Code.app.zip" \
  --arg sha256 "$SHA256" \
  --arg deviceId "$DEVICE_ID" \
  '{schemaVersion:1,channel:$channel,build:$build,sequence:$sequence,commit:$commit,bundleId:$bundleId,appPath:$appPath,zipPath:$zipPath,sha256:$sha256,deviceId:$deviceId}' \
  > "$POINTER_TMP"
cp "$POINTER_TMP" "$ARTIFACT_DIR/artifact.json"
chmod -R a-w "$ARTIFACT_DIR"
mv "$POINTER_TMP" "$POINTER_DIR/$CHANNEL.json"
printf '[swiftui-stream] ready: %s build %s at %s\n' "$CHANNEL" "$BUILD" "$ARTIFACT_DIR"
