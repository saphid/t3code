#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_REPO=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
TEST_ROOT=$(mktemp -d -t t3-swift-approved-tests.XXXXXX)
TEST_REPO="$TEST_ROOT/repo"
TEST_MANIFEST="$TEST_ROOT/manifest.json"
trap 'chmod -R u+w "$TEST_ROOT" 2>/dev/null || true; rm -r "$TEST_ROOT"' EXIT

branch=$(jq -r .branch "$SCRIPT_DIR/manifest.json")
git clone --quiet --no-local --branch "$branch" "$SOURCE_REPO" "$TEST_REPO"
git -C "$TEST_REPO" config user.name "SwiftUI approved verifier test"
git -C "$TEST_REPO" config user.email "swiftui-approved-test@example.invalid"
VERIFY="$TEST_REPO/scripts/t3-swift-approved/verify.sh"
MANIFEST="$TEST_REPO/scripts/t3-swift-approved/manifest.json"

expect_rejection() {
  label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'expected rejection: %s\n' "$label" >&2
    exit 1
  fi
}

expect_rejection_with_message() {
  label=$1
  expected=$2
  shift 2
  output=$("$@" 2>&1) && {
    printf 'expected rejection: %s\n' "$label" >&2
    exit 1
  }
  case "$output" in
    *"$expected"*) ;;
    *) printf 'wrong rejection for %s:\n%s\n' "$label" "$output" >&2; exit 1 ;;
  esac
}

"$VERIFY" --repo "$TEST_REPO"

printf '{}\n' >"$TEST_MANIFEST"
expect_rejection "invalid manifest schema" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.upstream.commit = ("0" * 40)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "missing upstream ancestor" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.featureTreeDigest = ("0" * 64)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed feature digest" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.overlayTreeDigest = ("0" * 64)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed overlay digest" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.policyTreeDigest = ("0" * 64)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed policy digest" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.features[0].reviewPatchId = ("0" * 40)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed review patch ID" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.candidates[0].integrationPatchId = ("0" * 40)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed integration patch ID" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

jq '.candidates[0].sourcePatchId = ("0" * 40)' "$MANIFEST" >"$TEST_MANIFEST"
expect_rejection "changed exact source patch ID" "$VERIFY" --repo "$TEST_REPO" --manifest "$TEST_MANIFEST"

printf '\n' >>"$TEST_REPO/apps/swift-ios/Features/Chat/FeatureComposerView.swift"
expect_rejection "dirty worktree" "$VERIFY" --repo "$TEST_REPO"
git -C "$TEST_REPO" restore apps/swift-ios/Features/Chat/FeatureComposerView.swift

git -C "$TEST_REPO" switch --quiet -c verifier-wrong-branch
expect_rejection "wrong branch" "$VERIFY" --repo "$TEST_REPO"
FAKE_BIN="$TEST_ROOT/no-xcode-bin"
mkdir "$FAKE_BIN"
for command in awk comm dirname git jq mktemp rm shasum sort; do
  ln -s "$(command -v "$command")" "$FAKE_BIN/$command"
done
expect_rejection_with_message "device installer source guard" "HEAD must be $branch" \
  env PATH="$FAKE_BIN" T3_SWIFT_VERIFY_BUNDLE_IDENTIFIERS_ONLY=1 \
  /bin/bash "$TEST_REPO/apps/swift-ios/Scripts/install-device.sh"
git -C "$TEST_REPO" switch --quiet "$branch"

printf '\n// committed approved-file tamper\n' \
  >>"$TEST_REPO/apps/swift-ios/Features/Chat/FeatureComposerView.swift"
git -C "$TEST_REPO" add apps/swift-ios/Features/Chat/FeatureComposerView.swift
git -C "$TEST_REPO" commit --quiet -m "test: change approved file"
expect_rejection "committed approved-file change" "$VERIFY" --repo "$TEST_REPO"
git -C "$TEST_REPO" switch --quiet "$branch"
git -C "$TEST_REPO" reset --quiet --hard "origin/$branch"

git -C "$TEST_REPO" commit --quiet --allow-empty -m "test: detached non-origin commit"
git -C "$TEST_REPO" switch --quiet --detach HEAD
expect_rejection_with_message "detached non-origin commit" \
  "HEAD must be $branch or a detached checkout of origin/$branch" \
  "$VERIFY" --repo "$TEST_REPO"
git -C "$TEST_REPO" switch --quiet "$branch"
git -C "$TEST_REPO" reset --quiet --hard "origin/$branch"

printf 'unapproved\n' >"$TEST_REPO/swiftui-approved-unrecorded.txt"
git -C "$TEST_REPO" add swiftui-approved-unrecorded.txt
git -C "$TEST_REPO" commit --quiet -m "test: unapproved path"
expect_rejection "unapproved committed path" "$VERIFY" --repo "$TEST_REPO"
git -C "$TEST_REPO" reset --quiet --hard "origin/$branch"

git -C "$TEST_REPO" switch --quiet --detach "origin/$branch"
"$VERIFY" --repo "$TEST_REPO"

printf 'swiftui-approved verifier tests passed\n'
