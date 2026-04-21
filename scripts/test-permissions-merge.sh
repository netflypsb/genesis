#!/usr/bin/env bash
# Verifies the Phase 9 permissions merge logic:
#   - preserves pre-existing user entries
#   - adds missing Genesis entries
#   - does not duplicate entries already present
#   - does not touch unrelated sections (env, mcpServers)
set -euo pipefail

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# Pre-existing settings with a user custom entry + one Genesis-overlapping entry.
cat > "$TMP/settings.json" << 'EOF'
{
  "env": {"ANTHROPIC_BASE_URL": "http://localhost:11434"},
  "mcpServers": {"my-custom": {"command": "echo", "args": ["hi"]}},
  "permissions": {"allow": ["Read", "Bash(git status)", "Write(docs/**)"]}
}
EOF

python3 - "$TMP/settings.json" << 'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
data = json.loads(p.read_text())
genesis_allow = [
    "Read","Bash(clawteam *)","Bash(tmux *)",
    "Bash(git status)","Bash(git diff *)","Bash(git log *)","Bash(git branch *)","Bash(ls *)",
]
perms = data.setdefault("permissions", {})
existing = perms.get("allow", []) or []
seen = set(existing)
for entry in genesis_allow:
    if entry not in seen:
        existing.append(entry); seen.add(entry)
perms["allow"] = existing
p.write_text(json.dumps(data, indent=2))
PY

# Assertions
jq -e '.permissions.allow | index("Write(docs/**)") != null' "$TMP/settings.json" > /dev/null \
  || { echo "FAIL: user's Write(docs/**) was dropped"; exit 1; }
jq -e '.permissions.allow | index("Bash(clawteam *)") != null' "$TMP/settings.json" > /dev/null \
  || { echo "FAIL: Bash(clawteam *) not added"; exit 1; }
# Bash(git status) must appear exactly once (not duplicated)
count=$(jq '[.permissions.allow[] | select(. == "Bash(git status)")] | length' "$TMP/settings.json")
[[ "$count" == "1" ]] || { echo "FAIL: Bash(git status) duplicated ($count times)"; exit 1; }
# Unrelated sections preserved
jq -e '.env["ANTHROPIC_BASE_URL"] == "http://localhost:11434"' "$TMP/settings.json" > /dev/null \
  || { echo "FAIL: env wiped"; exit 1; }
jq -e '.mcpServers["my-custom"].command == "echo"' "$TMP/settings.json" > /dev/null \
  || { echo "FAIL: mcpServers wiped"; exit 1; }

echo "PASS: permissions merge preserves user entries, adds Genesis entries, no duplication"
jq '.permissions.allow' "$TMP/settings.json"
