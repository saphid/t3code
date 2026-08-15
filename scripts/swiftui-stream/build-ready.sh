#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
APP_DIR="$REPO_ROOT/apps/swift-ios"
CHANNEL="${1:-}"
TEAM="${T3_SWIFT_DEVELOPMENT_TEAM:-}"
DEVICE_ID="${T3_SWIFT_DEVICE_ID:-}"
ARTIFACT_ROOT="${T3_SWIFT_ARTIFACT_ROOT:-$HOME/.t3/artifacts/swiftui-stream}"
UAT_CANDIDATE="${T3_SWIFT_UAT_CANDIDATE:-0}"

[[ "$UAT_CANDIDATE" == 0 || "$UAT_CANDIDATE" == 1 ]] || {
  echo "T3_SWIFT_UAT_CANDIDATE must be 0 or 1" >&2
  exit 1
}

case "$CHANNEL" in
  dev)
    CONFIGURATION=Dev
    SCHEME=T3CodeDev
    BUNDLE_ID=com.saphid.t3code.swiftui.dev
    EXPECTED_BRANCH=personal/swiftui-dev
    NATIVE_PLAN=DevPromotion
    UI_PLAN=DevPromotion
    ;;
  test)
    CONFIGURATION=Test
    SCHEME=T3CodeTest
    BUNDLE_ID=com.alxs.t3code.typed-swiftui.dev
    EXPECTED_BRANCH=personal/swiftui-test
    NATIVE_PLAN=TestTrain
    UI_PLAN=TestTrain
    ;;
  *) printf 'usage: %s dev|test\n' "$0" >&2; exit 2 ;;
esac

[[ -n "$TEAM" ]] || { echo "T3_SWIFT_DEVELOPMENT_TEAM is required" >&2; exit 1; }
[[ -n "$DEVICE_ID" ]] || { echo "T3_SWIFT_DEVICE_ID is required" >&2; exit 1; }
BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
if [[ "$CHANNEL" == "dev" && "$BRANCH" != "$EXPECTED_BRANCH" ]]; then
  [[ -n "$BRANCH" ]] || {
    echo "Dev review builds require the named feature branch from the proved receipt" >&2
    exit 1
  }
  git -C "$REPO_ROOT" fetch --no-tags origin personal/swiftui-dev "$BRANCH"
fi
python3 "$SCRIPT_DIR/test_stream.py"
"$SCRIPT_DIR/stream.py" validate
[[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] || {
  echo "refusing to publish a non-reproducible dirty build" >&2
  exit 1
}
unset T3_SWIFT_RESULT_BUNDLE_PATH T3_SWIFT_TEST_PRODUCTS_PATH \
  T3_SWIFT_BUILD_MANIFEST_PATH T3_SWIFT_SUMMARY_PATH T3_SWIFT_TESTS_PATH \
  T3_SWIFT_RECEIPT_PATH T3_SWIFT_ATTACHMENTS_PATH
T3_SWIFT_SCHEME="$SCHEME" \
T3_SWIFT_XCODE_TEST_PLAN="$NATIVE_PLAN" \
T3_SWIFT_SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}" \
  "$APP_DIR/Scripts/ci-test.sh"
T3_SWIFT_SCHEME="$SCHEME" \
T3_SWIFT_XCODE_TEST_PLAN="$UI_PLAN" \
T3_APP_FLOW_PLAN=regression \
T3_SWIFT_SIMULATOR_ID="${T3_SWIFT_SIMULATOR_ID:-}" \
  "$APP_DIR/Scripts/ci-app-flow-test.sh"
if [[ "$CHANNEL" == "test" ]]; then
  [[ "$BRANCH" == "$EXPECTED_BRANCH" ]] || {
    echo "Test builds must be published from $EXPECTED_BRANCH, not $BRANCH" >&2
    exit 1
  }
  if [[ "$UAT_CANDIDATE" == 1 && -n "${T3_SWIFT_BUILD_NUMBER:-}" ]]; then
    echo "UAT Test candidates allocate their own monotonic build number" >&2
    exit 1
  fi
elif [[ "$UAT_CANDIDATE" == 1 ]]; then
  echo "T3_SWIFT_UAT_CANDIDATE is valid only for the Test channel" >&2
  exit 1
elif [[ "$BRANCH" != "$EXPECTED_BRANCH" ]]; then
  printf '[swiftui-stream] preparing one proved Dev candidate from %s\n' "$BRANCH"
fi

PREFLIGHT_MANIFEST="$(mktemp -t t3-swift-testing-preflight.XXXXXX)"
TESTING_MANIFEST="$(mktemp -t t3-swift-testing.XXXXXX)"
trap 'unlink "$PREFLIGHT_MANIFEST" 2>/dev/null || true; unlink "$TESTING_MANIFEST" 2>/dev/null || true' EXIT
if [[ -n "${T3_SWIFT_BUILD_NUMBER:-}" ]]; then
  PREFLIGHT_BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL" --peek --requested "$T3_SWIFT_BUILD_NUMBER")"
else
  PREFLIGHT_BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL" --peek)"
fi
python3 "$SCRIPT_DIR/generate_testing_manifest.py" \
  "$REPO_ROOT" "$CHANNEL" "$PREFLIGHT_BUILD" "$PREFLIGHT_MANIFEST"

if [[ "$CHANNEL" == test && "$UAT_CANDIDATE" == 1 ]]; then
  BUILD="$("$SCRIPT_DIR/next-build.py" test)"
elif [[ "$CHANNEL" == test ]]; then
  [[ -n "${T3_SWIFT_BUILD_NUMBER:-}" ]] || {
    echo "Test builds require a number reserved by stream.py stage-test-build" >&2
    exit 1
  }
  BUILD="$(
    "$SCRIPT_DIR/next-build.py" test \
      --requested "$T3_SWIFT_BUILD_NUMBER" \
      --accept-reserved
  )"
elif [[ -n "${T3_SWIFT_BUILD_NUMBER:-}" ]]; then
  BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL" --requested "$T3_SWIFT_BUILD_NUMBER")"
else
  BUILD="$("$SCRIPT_DIR/next-build.py" "$CHANNEL")"
fi
CATALOG_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SOURCE_COMMIT="$CATALOG_COMMIT"
if [[ "$CHANNEL" == test && "$UAT_CANDIDATE" != 1 ]]; then
  CATALOG_CONTRACT="$(
    "$SCRIPT_DIR/stream.py" validate-test-build-catalog --build "$BUILD"
  )"
  SOURCE_COMMIT="$(jq -r .sourceCommit <<<"$CATALOG_CONTRACT")"
  [[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
    echo "invalid Test catalog source commit: $SOURCE_COMMIT" >&2
    exit 1
  }
fi
if [[ "$CHANNEL" == test && "$UAT_CANDIDATE" == 1 ]]; then
  printf '[swiftui-stream] preparing unapproved Test UAT candidate from %s\n' "$SOURCE_COMMIT"
fi
DERIVED="${T3_SWIFT_DERIVED_DATA_PATH:-$APP_DIR/.derivedData/ready-$CHANNEL}"
CLONED_SOURCE_PACKAGES_PATH="${T3_SWIFT_CLONED_SOURCE_PACKAGES_PATH:-$HOME/.t3/cache/swift-ios/source-packages}"
COMPILATION_CACHE_PATH="${T3_SWIFT_COMPILATION_CACHE_PATH:-$HOME/.t3/cache/swift-ios/compilation-cache}"
DESTINATION="generic/platform=iOS"
python3 "$SCRIPT_DIR/generate_testing_manifest.py" \
  "$REPO_ROOT" "$CHANNEL" "$BUILD" "$TESTING_MANIFEST"
BUILD_TESTING="$(base64 < "$TESTING_MANIFEST" | tr -d '\n')"
mkdir -p "$CLONED_SOURCE_PACKAGES_PATH" "$COMPILATION_CACHE_PATH"

xcodebuild build \
  -quiet \
  -project "$APP_DIR/T3Code.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED" \
  -clonedSourcePackagesDirPath "$CLONED_SOURCE_PACKAGES_PATH" \
  -disablePackageRepositoryCache \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  "DEVELOPMENT_TEAM=$TEAM" \
  "CURRENT_PROJECT_VERSION=$BUILD" \
  "COMPILATION_CACHE_CAS_PATH=$COMPILATION_CACHE_PATH" \
  "T3_GIT_COMMIT=$SOURCE_COMMIT" \
  "T3_GIT_REPO_URL=https://github.com/saphid/t3code-personal" \
  "T3_GIT_BASE_REF=upstream/t3code/rebuild-mobile-app-swift" \
  "T3_BUILD_TESTING=$BUILD_TESTING"

APP_PATH="$DERIVED/Build/Products/$CONFIGURATION-iphoneos/T3Code.app"
[[ -d "$APP_PATH" ]] || { echo "missing built app: $APP_PATH" >&2; exit 1; }
ACTUAL_BUNDLE="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")"
ACTUAL_BUILD="$(plutil -extract CFBundleVersion raw -o - "$APP_PATH/Info.plist")"
ACTUAL_CHANNEL="$(plutil -extract T3BuildChannel raw -o - "$APP_PATH/Info.plist")"
ACTUAL_COMMIT="$(plutil -extract T3GitCommit raw -o - "$APP_PATH/Info.plist")"
ACTUAL_TESTING="$(plutil -extract T3BuildTesting raw -o - "$APP_PATH/Info.plist")"
[[ "$ACTUAL_BUNDLE" == "$BUNDLE_ID" ]] || { echo "unexpected bundle $ACTUAL_BUNDLE" >&2; exit 1; }
[[ "$ACTUAL_BUILD" == "$BUILD" ]] || { echo "unexpected build $ACTUAL_BUILD" >&2; exit 1; }
[[ "$ACTUAL_CHANNEL" == "$CHANNEL" ]] || { echo "unexpected channel $ACTUAL_CHANNEL" >&2; exit 1; }
[[ "$ACTUAL_COMMIT" == "$SOURCE_COMMIT" ]] || { echo "unexpected commit $ACTUAL_COMMIT" >&2; exit 1; }
[[ "$ACTUAL_TESTING" == "$BUILD_TESTING" ]] || { echo "unexpected testing manifest" >&2; exit 1; }
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

ARTIFACT_DIR="$ARTIFACT_ROOT/$CHANNEL/$BUILD-$SOURCE_COMMIT"
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
  --arg commit "$SOURCE_COMMIT" \
  --arg catalogCommit "$CATALOG_COMMIT" \
  --arg bundleId "$BUNDLE_ID" \
  --arg appPath "$ARTIFACT_DIR/T3Code.app" \
  --arg zipPath "$ARTIFACT_DIR/T3Code.app.zip" \
  --arg sha256 "$SHA256" \
  --arg deviceId "$DEVICE_ID" \
  --arg candidateKind "$(if [[ "$UAT_CANDIDATE" == 1 ]]; then printf uat; else printf approval; fi)" \
  '{schemaVersion:1,channel:$channel,build:$build,sequence:$sequence,commit:$commit,catalogCommit:$catalogCommit,bundleId:$bundleId,appPath:$appPath,zipPath:$zipPath,sha256:$sha256,deviceId:$deviceId,candidateKind:$candidateKind}' \
  > "$POINTER_TMP"
cp "$POINTER_TMP" "$ARTIFACT_DIR/artifact.json"
chmod -R a-w "$ARTIFACT_DIR"
mv "$POINTER_TMP" "$POINTER_DIR/$CHANNEL.json"
printf '[swiftui-stream] ready: %s build %s at %s\n' "$CHANNEL" "$BUILD" "$ARTIFACT_DIR"
