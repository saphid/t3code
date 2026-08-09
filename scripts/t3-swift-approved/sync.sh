#!/bin/sh
set -eu

PATH="/Users/saphid/.homebrew/bin:/opt/homebrew/bin:/usr/local/bin:/Users/saphid/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/usr/bin/false

ORIGIN_URL="https://github.com/saphid/t3code-personal.git"
UPSTREAM_URL="https://github.com/pingdotgg/t3code.git"
BRANCH="personal/swiftui-approved"
UPSTREAM_REF="t3code/rebuild-mobile-app-swift"
SCRATCH="$HOME/.cache/t3-swift-approved-sync/repo"
LOCK="$HOME/.cache/t3-swift-approved-sync/sync.lock"
ISSUE_REPO="saphid/t3code-personal"
ISSUE_TITLE="SwiftUI approved phone lane needs reconciliation"
ALERT_MARKER="$HOME/.cache/t3-swift-approved-sync/needs-reconciliation"
LOCK_ALERT_MARKER="$HOME/.cache/t3-swift-approved-sync/wedged-lock-alerted"
ALERT_SENT=0
TEMPORARY=""

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
file_alert() {
  log "ALERT: $1"
  body=$(printf '%s\n\n%s\n\n%s' "$1" "$2" "Nothing was pushed. The approved phone branch and installed app are unchanged.")
  printf '%s\n' "$body" >"$ALERT_MARKER"

  if command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 \
    && gh auth status --hostname github.com >/dev/null 2>&1; then
    issue=$(gh issue list --repo "$ISSUE_REPO" --state open --limit 1000 --json number,title \
      2>/dev/null | jq -r --arg title "$ISSUE_TITLE" \
      '.[] | select(.title == $title) | .number' | head -n 1 || true)
    if [ -n "$issue" ]; then
      if gh issue comment "$issue" --repo "$ISSUE_REPO" --body "$body" >/dev/null 2>&1; then
        unlink "$ALERT_MARKER" 2>/dev/null || true
        return
      fi
      log "could not append alert to issue #$issue"
    elif gh issue create --repo "$ISSUE_REPO" --title "$ISSUE_TITLE" --body "$body" >/dev/null 2>&1; then
      unlink "$ALERT_MARKER" 2>/dev/null || true
      return
    else
      log "could not create reconciliation issue"
    fi
  else
    log "GitHub CLI is missing or unauthenticated"
  fi
  log "durable reconciliation marker retained at $ALERT_MARKER"
}
alert() {
  ALERT_SENT=1
  file_alert "$1" "$2"
  exit 1
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  [ -z "$TEMPORARY" ] || rm -f "$TEMPORARY"
  unlink "$LOCK" 2>/dev/null || true
  if [ "$status" -ne 0 ] && [ "$ALERT_SENT" -eq 0 ]; then
    file_alert "The approved-lane sync exited unexpectedly." \
      "Exit status $status. Inspect the launchd log for the failing command."
  fi
  exit "$status"
}

mkdir -p "$(dirname "$LOCK")"
if ! /usr/bin/shlock -f "$LOCK" -p "$$"; then
  if [ ! -f "$LOCK" ]; then
    file_alert "The approved-lane sync could not acquire its lock." \
      "$LOCK was not created. Check that shlock exists and the cache directory is writable."
    exit 1
  fi
  owner=$(head -n 1 "$LOCK" 2>/dev/null || printf unknown)
  now=$(date +%s)
  modified=$(stat -f %m "$LOCK" 2>/dev/null || printf '%s' "$now")
  age=$((now - modified))
  if [ "$age" -gt 10800 ] && [ ! -e "$LOCK_ALERT_MARKER" ]; then
    file_alert "The approved-lane sync appears wedged." \
      "PID $owner has held the sync lock for ${age}s. Nothing was changed; inspect the process and launchd log."
    : >"$LOCK_ALERT_MARKER"
  fi
  log "another sync owns $LOCK with PID $owner; exiting"
  exit 0
fi
unlink "$LOCK_ALERT_MARKER" 2>/dev/null || true
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -d "$SCRATCH/.git" ]; then
  [ ! -e "$SCRATCH" ] || alert "Scratch path is not a usable clone." "$SCRATCH"
  git clone --branch "$BRANCH" "$ORIGIN_URL" "$SCRATCH" || alert "Could not clone the approved branch." "$SCRATCH"
  git -C "$SCRATCH" remote add upstream "$UPSTREAM_URL"
  git -C "$SCRATCH" config user.name "Alex Southwell"
  git -C "$SCRATCH" config user.email "saphid@gmail.com"
fi

cd "$SCRATCH"
git fetch --quiet origin "$BRANCH" || alert "Could not fetch origin/$BRANCH." "$SCRATCH"
git fetch --quiet upstream "$UPSTREAM_REF" || alert "Could not fetch upstream/$UPSTREAM_REF." "$SCRATCH"
# This checkout belongs only to the sync job. Recover automatically from an
# interrupted merge or power loss before recreating the approved branch.
unlink "$(git rev-parse --git-path index.lock)" 2>/dev/null || true
git reset --quiet --hard
git clean --quiet -fd
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"

if git merge-base --is-ancestor "upstream/$UPSTREAM_REF" HEAD; then
  if ! scripts/t3-swift-approved/verify.sh \
    || ! scripts/t3-swift-approved/verify.test.sh; then
    alert "The approved phone lane failed its source manifest." "Review the verifier output in the sync log."
  fi
  log "approved lane already includes upstream/$UPSTREAM_REF $(git rev-parse --short upstream/$UPSTREAM_REF)"
  exit 0
fi

base=$(git rev-parse HEAD)
if ! GIT_EDITOR=true git merge --no-ff --no-edit "upstream/$UPSTREAM_REF"; then
  conflicts=$(git diff --name-only --diff-filter=U | head -n 20 || true)
  git merge --abort || true
  alert "Theo's SwiftUI branch conflicts with the approved phone lane." "$conflicts"
fi

manifest=scripts/t3-swift-approved/manifest.json
TEMPORARY=$(mktemp -t t3-swift-approved-manifest.XXXXXX)
upstream_tip=$(git rev-parse "upstream/$UPSTREAM_REF")
jq --arg commit "$upstream_tip" '.upstream.commit = $commit' "$manifest" >"$TEMPORARY"
mv "$TEMPORARY" "$manifest"
TEMPORARY=""
git add "$manifest"
git commit --amend --no-edit

if ! scripts/t3-swift-approved/verify.sh \
  || ! scripts/t3-swift-approved/verify.test.sh \
  || ! apps/swift-ios/Scripts/ci-test.sh; then
  git reset --hard "$base"
  alert "Theo's update changed approved behavior or failed native verification." "Review the upstream diff and approve a reconciled manifest manually."
fi

git push origin "$BRANCH" || {
  git reset --hard "$base"
  alert "Could not push the verified upstream refresh." "Origin may have moved during verification."
}
log "pushed approved lane with upstream $upstream_tip"
