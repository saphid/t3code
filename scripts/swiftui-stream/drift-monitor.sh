#!/usr/bin/env bash
set -euo pipefail

REPO="${SWIFTUI_STREAM_REPO:-}"
STATE_DIR="${SWIFTUI_STREAM_STATE_DIR:-$HOME/.t3/swiftui-stream}"
GH_BIN="${SWIFTUI_STREAM_GH_BIN:-/Users/saphid/bin/gh}"
[[ -n "$REPO" ]] || exit 0
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || exit 0
mkdir -p "$STATE_DIR"

git -C "$REPO" fetch --quiet origin \
  refs/heads/personal/swiftui-dev:refs/remotes/origin/personal/swiftui-dev \
  refs/heads/personal/swiftui-test:refs/remotes/origin/personal/swiftui-test || true
git -C "$REPO" fetch --quiet upstream \
  refs/heads/t3code/rebuild-mobile-app-swift:refs/remotes/upstream/t3code/rebuild-mobile-app-swift || true

THEO="$(git -C "$REPO" rev-parse --verify upstream/t3code/rebuild-mobile-app-swift 2>/dev/null || true)"
DEV="$(git -C "$REPO" rev-parse --verify origin/personal/swiftui-dev 2>/dev/null || true)"
TEST="$(git -C "$REPO" rev-parse --verify origin/personal/swiftui-test 2>/dev/null || true)"
STATUS=healthy
DETAIL="Theo under Dev; Dev under Test"

if [[ -z "$THEO" || -z "$DEV" || -z "$TEST" ]]; then
  STATUS=missing-ref
  DETAIL="one or more canonical SwiftUI refs are missing"
elif ! git -C "$REPO" merge-base --is-ancestor "$THEO" "$DEV"; then
  STATUS=dev-behind-theo
  DETAIL="Theo is not an ancestor of Dev"
elif ! git -C "$REPO" merge-base --is-ancestor "$DEV" "$TEST"; then
  STATUS=test-missing-dev
  DETAIL="Dev is not an ancestor of Test"
fi

DIGEST="$(printf '%s|%s' "$STATUS" "$DETAIL" | shasum -a 256 | awk '{print $1}')"
LAST="$(cat "$STATE_DIR/drift-monitor.digest" 2>/dev/null || true)"
PREVIOUS_STATUS="$(jq -r '.status // empty' "$STATE_DIR/drift-monitor.json" 2>/dev/null || true)"
[[ "$DIGEST" == "$LAST" ]] && exit 0
jq -n --arg status "$STATUS" --arg detail "$DETAIL" --arg theo "$THEO" --arg dev "$DEV" --arg test "$TEST" \
  '{status:$status,detail:$detail,theo:$theo,dev:$dev,test:$test}' > "$STATE_DIR/drift-monitor.next.json"

if [[ "$STATUS" != healthy ]]; then
  "$GH_BIN" issue comment 53 --repo saphid/t3code-personal \
    --body "SwiftUI stream drift monitor: **$STATUS** — $DETAIL. This monitor is read-only; it did not merge or push." \
    >/dev/null
elif [[ -n "$LAST" && "$PREVIOUS_STATUS" != healthy ]]; then
  "$GH_BIN" issue comment 53 --repo saphid/t3code-personal \
    --body "SwiftUI stream drift monitor recovered: Theo is under Dev and Dev is under Test." \
    >/dev/null
fi
mv "$STATE_DIR/drift-monitor.next.json" "$STATE_DIR/drift-monitor.json"
printf '%s\n' "$DIGEST" > "$STATE_DIR/drift-monitor.digest"
