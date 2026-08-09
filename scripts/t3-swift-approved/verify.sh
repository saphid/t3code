#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)
MANIFEST=$SCRIPT_DIR/manifest.json

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) [ "$#" -ge 2 ] || exit 2; MANIFEST=$2; shift 2 ;;
    --repo) [ "$#" -ge 2 ] || exit 2; REPO=$2; shift 2 ;;
    *) printf 'usage: %s [--manifest path] [--repo path]\n' "$0" >&2; exit 2 ;;
  esac
done

fail() {
  printf '[swiftui-approved] rejected: %s\n' "$*" >&2
  exit 1
}

for command in git jq shasum; do
  command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
done

jq -e '
  .schemaVersion == 1 and
  (.branch | type == "string" and length > 0) and
  (.upstream.commit | test("^[0-9a-f]{40}$")) and
  (.features | length > 0) and
  ([.features[] |
    (.pullRequest | test("^https://github.com/pingdotgg/t3code/pull/[0-9]+$")) and
    (.reviewCommit | test("^[0-9a-f]{40}$")) and
    (.reviewPatchId | test("^[0-9a-f]{40}$")) and
    (.integratedCommit | test("^[0-9a-f]{40}$"))] | all) and
  (.featureTreeDigest | test("^[0-9a-f]{64}$")) and
  (.overlayTreeDigest | test("^[0-9a-f]{64}$")) and
  (.policyTreeDigest | test("^[0-9a-f]{64}$"))
' "$MANIFEST" >/dev/null || fail "manifest schema is invalid"

expected_branch=$(jq -r .branch "$MANIFEST")
head=$(git -C "$REPO" rev-parse HEAD)
branch=$(git -C "$REPO" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [ "$branch" != "$expected_branch" ]; then
  approved_ref=$(git -C "$REPO" rev-parse --verify "refs/remotes/origin/$expected_branch" 2>/dev/null || true)
  [ -z "$branch" ] && [ "$approved_ref" = "$head" ] || \
    fail "HEAD must be $expected_branch or a detached checkout of origin/$expected_branch"
fi

[ -z "$(git -C "$REPO" status --porcelain)" ] || fail "source worktree is dirty"

upstream_commit=$(jq -r .upstream.commit "$MANIFEST")
git -C "$REPO" merge-base --is-ancestor "$upstream_commit" HEAD || \
  fail "approved upstream commit $upstream_commit is not an ancestor"

patch_id() {
  git -C "$REPO" show --pretty=format: "$1" | git patch-id --stable | awk '{print $1}'
}

jq -r '.features[] | [.reviewCommit, .reviewPatchId, .integratedCommit, .pullRequest] | @tsv' "$MANIFEST" |
while IFS="$(printf '\t')" read -r review_commit review_patch_id integrated_commit pull_request; do
  git -C "$REPO" merge-base --is-ancestor "$integrated_commit" HEAD || \
    fail "approved commit for $pull_request is not an ancestor"
  [ "$review_patch_id" = "$(patch_id "$integrated_commit")" ] || \
    fail "integrated patch no longer matches $pull_request"
  if git -C "$REPO" cat-file -e "$review_commit^{commit}" 2>/dev/null; then
    [ "$review_patch_id" = "$(patch_id "$review_commit")" ] || \
      fail "stored review commit no longer matches $pull_request"
  fi
done

paths_digest() {
  key=$1
  jq -r ".$key[]" "$MANIFEST" |
  while IFS= read -r approved_path; do
    git -C "$REPO" ls-tree -r HEAD -- "$approved_path"
  done | sort | shasum -a 256 | awk '{print $1}'
}

[ "$(paths_digest featurePaths)" = "$(jq -r .featureTreeDigest "$MANIFEST")" ] || \
  fail "approved feature files changed without a new approval manifest"
[ "$(paths_digest overlayPaths)" = "$(jq -r .overlayTreeDigest "$MANIFEST")" ] || \
  fail "personal signing or install guard changed without a new approval manifest"
[ "$(paths_digest policyDigestPaths)" = "$(jq -r .policyTreeDigest "$MANIFEST")" ] || \
  fail "approved-lane policy changed without a new approval manifest"

allowed=$(mktemp -t t3-swift-approved-allowed.XXXXXX)
actual=""
trap '[ -z "$allowed" ] || rm -f "$allowed"; [ -z "$actual" ] || rm -f "$actual"' EXIT
actual=$(mktemp -t t3-swift-approved-actual.XXXXXX)
jq -r '.featurePaths[], .overlayPaths[], .policyPaths[]' "$MANIFEST" | sort -u >"$allowed"
git -C "$REPO" diff --name-only "$upstream_commit..HEAD" | sort -u >"$actual"
unexpected=$(comm -13 "$allowed" "$actual")
[ -z "$unexpected" ] || fail "unapproved paths differ from Theo's branch:
$unexpected"

printf '[swiftui-approved] accepted %s at %s with %s approved upstream PRs\n' \
  "$expected_branch" "${head%????????????????????????????????}" "$(jq '.features | length' "$MANIFEST")"
