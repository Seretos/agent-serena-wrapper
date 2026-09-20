#!/usr/bin/env bash
# Print the highest semver release tag (other than the one being created) of the
# same plugin. Usage: git tag -l | prev-release-tag.sh <tag-being-created>
#
# Resolution never blocks: any tag list (empty, foreign-only, single) exits 0
# and prints nothing when there is no predecessor. The only non-zero exit is 2,
# when <tag-being-created> is not `<plugin>--v<strict semver>` (this script is
# the single home of the release-version grammar).
set -euo pipefail

NEW="${1:-}"

# Strict semver core (no leading zeros) + optional prerelease.
CORE='(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
PRE='(-[0-9A-Za-z.-]+)?'
RE="^([A-Za-z0-9._-]+)--v(${CORE})(${PRE})\$"

if [[ ! "$NEW" =~ $RE ]]; then
  echo "::error::Release tag '$NEW' is not '<plugin>--v<MAJOR.MINOR.PATCH[-PRERELEASE]>' (strict semver, no leading zeros)." >&2
  exit 2
fi
PLUGIN="${BASH_REMATCH[1]}"

# Explicit sort key: zero-padded numeric core, release (1) > prerelease (0),
# prerelease identifiers compared dot-wise with numeric ones padded.
sort_key() {
  local ver="$1" core pre="" a b c ident key out=""
  local -a idents
  core="${ver%%-*}"
  [[ "$ver" == *-* ]] && pre="${ver#*-}"
  IFS=. read -r a b c <<<"$core"
  key=$(printf '%010d.%010d.%010d' "$a" "$b" "$c")
  if [ -z "$pre" ]; then
    printf '%s|1|' "$key"
    return
  fi
  IFS=. read -r -a idents <<<"$pre"
  for ident in "${idents[@]}"; do
    if [[ "$ident" =~ ^[0-9]+$ ]]; then
      out+=$(printf '0%010d' "$((10#$ident))")
    else
      out+="1$ident"
    fi
    out+="."
  done
  printf '%s|0|%s' "$key" "$out"
}

TAG_RE="^${PLUGIN}--v(${CORE}${PRE})\$"
KEYED=""
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [ "$line" = "$NEW" ] && continue
  if [[ "$line" =~ $TAG_RE ]]; then
    KEYED+="$(sort_key "${BASH_REMATCH[1]}")"$'\t'"$line"$'\n'
  fi
done

if [ -n "$KEYED" ]; then
  printf '%s' "$KEYED" | LC_ALL=C sort -r | cut -f2 | sed -n '1p'
fi
