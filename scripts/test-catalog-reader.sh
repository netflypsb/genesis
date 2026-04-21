#!/usr/bin/env bash
# Smoke-test for provision.sh's catalog-reader logic.
# Sources the helpers from provision.sh, then iterates each catalog with
# a few GENESIS_ENABLE / GENESIS_DISABLE scenarios and prints the
# resolved install list.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pull just the helper functions out of provision.sh
catalog_is_enabled() {
  local name="$1" default="$2"
  if [[ ",${GENESIS_DISABLE:-}," == *",${name},"* ]]; then return 1; fi
  if [[ ",${GENESIS_ENABLE:-},"  == *",${name},"* ]]; then return 0; fi
  [[ "$default" == "true" ]]
}
catalog_enabled_items() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local item name default
  while IFS= read -r item; do
    name=$(echo "$item"    | jq -r '.name')
    default=$(echo "$item" | jq -r '.default')
    if catalog_is_enabled "$name" "$default"; then
      echo "$item"
    fi
  done < <(jq -c '.items[]' "$file")
}

print_scenario() {
  local label="$1" file="$2"
  echo ""
  echo "== $label =="
  catalog_enabled_items "$file" | jq -r '.name' | sed 's/^/  /'
}

for cat in skills mcps agents templates; do
  f="$REPO_ROOT/catalog/${cat}.json"
  echo ""
  echo "#### $cat ####"

  GENESIS_ENABLE= GENESIS_DISABLE= print_scenario "default (no flags)" "$f"
  GENESIS_ENABLE= GENESIS_DISABLE="playwright,pdf" print_scenario "disable playwright,pdf" "$f"
  GENESIS_ENABLE="vibe-trading" GENESIS_DISABLE= print_scenario "enable vibe-trading (no-op today)" "$f"
done
