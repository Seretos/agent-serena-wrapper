#!/usr/bin/env bash
# Side-effect-free release pre-flight (read-only ref lookups via the GitHub CLI only).
# Env: REPO, TAG, PREV_TAG (empty for a first-ever release).
# Fails (exit 1) when <TAG> or src/<TAG> already exist, or when src/<PREV_TAG>
# is missing (printing the bootstrap commands).
set -euo pipefail

: "${REPO:?REPO is required}"
: "${TAG:?TAG is required}"
PREV_TAG="${PREV_TAG:-}"

# ref_exists <tag-ref>: 0 = exists, 1 = absent (HTTP 404). Any other failure
# aborts the script -- an API error must never read as "absent".
ref_exists() {
  local out
  if out=$(gh api "repos/${REPO}/git/refs/tags/$1" 2>&1); then
    return 0
  fi
  if printf '%s' "$out" | grep -Eq 'HTTP 404|Not Found'; then
    return 1
  fi
  echo "::error::Could not look up tag ref '$1' (not a 404): $out"
  exit 1
}

if ref_exists "$TAG"; then
  echo "::error::Tag ${TAG} already exists. Delete it first or pick a new version."
  exit 1
fi

if ref_exists "src/${TAG}"; then
  echo "::error::Source marker src/${TAG} already exists (left over from a burned version?). Delete it deliberately or pick a new version; it is never moved automatically."
  exit 1
fi

if [ -n "$PREV_TAG" ] && ! ref_exists "src/${PREV_TAG}"; then
  echo "::error::Source marker src/${PREV_TAG} is missing; the changelog cannot be scoped without it."
  echo "Bootstrap it once, at the exact head_sha of ${PREV_TAG}'s successful release.yml run"
  echo "(list runs with: gh run list --workflow=release.yml --json databaseId,headSha,displayTitle,createdAt,conclusion):"
  echo "  git tag src/${PREV_TAG} <head_sha of that release run>"
  echo "  git push origin src/${PREV_TAG}"
  echo "If that run's metadata is gone, a human must decide; do not guess a commit."
  exit 1
fi

echo "Pre-flight OK: ${TAG} and src/${TAG} are free${PREV_TAG:+, src/${PREV_TAG} present}."
