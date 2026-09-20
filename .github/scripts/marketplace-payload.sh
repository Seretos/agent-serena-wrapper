#!/usr/bin/env bash
# Print the agent-marketplace `plugin-release` dispatch document to stdout.
# Env: REPO, TAG, NAME, DESCRIPTION, VERSION. The changelog is the GitHub
# Release body of $TAG; the `changelog` key is omitted when the body is empty.
set -euo pipefail

: "${REPO:?REPO is required}"
: "${TAG:?TAG is required}"
: "${NAME:?NAME is required}"
: "${DESCRIPTION:?DESCRIPTION is required}"
: "${VERSION:?VERSION is required}"

# `&& printf x` keeps trailing newlines through $(...); a failing CLI call
# aborts (assignment under set -e), which `;` would mask.
CHANGELOG=$(gh release view "$TAG" --repo "$REPO" --json body --jq .body && printf x)
CHANGELOG="${CHANGELOG%x}"
# --jq appends exactly one newline; strip only that one.
CHANGELOG="${CHANGELOG%$'\n'}"

jq -n \
  --arg name "$NAME" \
  --arg description "$DESCRIPTION" \
  --arg repo "$REPO" \
  --arg version "$VERSION" \
  --arg tag "$TAG" \
  --arg changelog "$CHANGELOG" \
  --argjson tags '["coding"]' \
  '{
    event_type: "plugin-release",
    client_payload: ({
      name: $name,
      description: $description,
      repo: $repo,
      category: "skill",
      version: $version,
      ref: $tag,
      icon: ("https://raw.githubusercontent.com/" + $repo + "/" + $tag + "/assets/icon.png"),
      description_url: ("https://raw.githubusercontent.com/" + $repo + "/" + $tag + "/description.md"),
      tags: $tags
    } + (if $changelog == "" then {} else {changelog: $changelog} end))
  }'
