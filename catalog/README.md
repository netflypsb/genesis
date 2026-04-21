# Genesis catalog

Single source of truth for everything the wizard can install into the
sandbox. Each catalog file is a small JSON manifest the PowerShell wizard
and the bash provisioner both read.

## Files

| File | Describes | Installed by |
|---|---|---|
| `skills.json` | Claude Code skills (each a `SKILL.md` + assets) | `provision.sh` Phase 8 |
| `mcps.json` | MCP servers (user-scope) | `provision.sh` Phase 7 |
| `agents.json` | Claude Code subagent prompts | `provision.sh` Phase 10 |
| `templates.json` | ClawTeam team templates (TOML) | `provision.sh` Phase 10 (populated in milestone 2.1) |

## Item schema (common fields)

```json
{
  "name": "docx",
  "source": "skills/docx",
  "install_to": "~/.claude/skills/docx",
  "default": true,
  "tags": ["office", "bundled"]
}
```

- `name` (string, required) — selector used in `-Enable` / `-Disable`
  wizard flags.
- `source` (string, required) — path relative to repo root, OR the
  special value `"builtin"` for items installed by external tooling
  (e.g. an npm global).
- `install_to` (string, optional) — absolute install path inside the
  sandbox. Uses `~` for the provisioning user's home.
- `default` (bool, required) — whether the item is installed by a
  plain `setup-genesis.ps1` run with no flags.
- `tags` (array of strings, optional) — free-form labels for
  documentation and future filtering.

### `mcps.json` adds

- `scope` — always `"user"` today.
- `command` — executable the MCP server runs under (`uvx`, `npx`,
  `node`, ...).
- `args` — string array passed to `claude mcp add --scope <scope>
  <name> -- <command> <args...>`.

## Enable / disable resolution

For each item the effective state is:

```
if name in GENESIS_DISABLE    -> not installed
else if name in GENESIS_ENABLE -> installed
else                           -> follow .default
```

`GENESIS_DISABLE` / `GENESIS_ENABLE` are comma-separated env vars set by
the wizard's `-Disable`/`-Enable` flags.

## Adding a new item

1. Drop the asset into `skills/<name>/`, `agents/<name>.md`,
   `templates/<name>.toml`, or add an npm/uvx-backed MCP.
2. Add an entry to the appropriate catalog file.
3. Rerun the wizard — the installer picks it up automatically.

No edits to `provision.sh` or `setup-genesis.ps1` required for simple
additions.

## Backwards compatibility

If a user's on-disk `provision.sh` runs against a clone that lacks
`catalog/` (for example because their local checkout predates
milestone 2.0), the provisioner falls back to the pre-catalog hardcoded
list. The end state is identical.
