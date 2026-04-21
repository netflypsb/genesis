#!/usr/bin/env bash
# Validates every catalog/*.json file: parses as JSON, has the expected
# shape, and every `source` path resolves to a real file/directory in the
# repo. Exit non-zero on any failure. Designed for CI + local sanity check.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG_DIR="$REPO_ROOT/catalog"

if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "catalog/ missing; skipping validation" >&2
  exit 0
fi

fail=0
for f in "$CATALOG_DIR"/*.json; do
  name=$(basename "$f")

  # 1. Valid JSON
  if ! jq -e '.' "$f" >/dev/null 2>&1; then
    echo "FAIL: $name is not valid JSON"; fail=1; continue
  fi

  # 2. Has .version and .items
  if ! jq -e '.version and (.items | type == "array")' "$f" >/dev/null 2>&1; then
    echo "FAIL: $name missing .version or .items[]"; fail=1; continue
  fi

  # 3. Every item has name + default
  bad_items=$(jq -r '.items[] | select((.name // "") == "" or (.default | type != "boolean")) | .name // "<unnamed>"' "$f")
  if [[ -n "$bad_items" ]]; then
    echo "FAIL: $name items missing name/default: $bad_items"; fail=1; continue
  fi

  # 4. Every item.source resolves in the repo (for asset-backed catalogs:
  #    skills, agents, templates). Skipped for mcps.json.
  case "$name" in
    skills.json|agents.json|templates.json)
      while IFS= read -r src; do
        [[ -z "$src" ]] && continue
        if [[ ! -e "$REPO_ROOT/$src" ]]; then
          echo "FAIL: $name references missing source: $src"; fail=1
        fi
      done < <(jq -r '.items[].source // empty' "$f")
      ;;
  esac

  echo "PASS: $name ($(jq '.items | length' "$f") items)"
done

exit "$fail"
