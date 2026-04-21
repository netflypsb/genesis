# Repo reorganization — pluggable catalog architecture

## Why

Today Genesis hardcodes what gets installed. Phase 2 introduces:

- New asset class: **ClawTeam team templates** (`*.toml`).
- New skill: **`clawteam` skill** (sourced from upstream).
- New optional MCP: **`vibe-trading-mcp`**.
- New optional capability: **OpenClaw daemon**.

Without restructure, every new asset means another bespoke phase in
`provision.sh`. With a small catalog system, adding the next team or skill
is a one-file PR.

## Proposed top-level layout

```
genesis/
├─ setup/
│   ├─ bootstrap.ps1            unchanged: clones + invokes wizard
│   └─ setup-genesis.ps1        wizard, reads catalogs to build flag list
├─ provision.sh                 unchanged contract; reads catalogs in WSL
├─ Vagrantfile                  unchanged
│
├─ catalog/                     ← NEW: single source of truth
│   ├─ skills.json              maps name -> source path + install dest
│   ├─ templates.json           maps name -> source toml + install dest
│   ├─ mcps.json                same idea (replaces today's mcp/registry.json)
│   └─ agents.json              maps name -> claude subagent .md files
│
├─ skills/                      content (unchanged, now indexed by catalog)
│   ├─ docx/   pdf/   xlsx/   pptx/
│   ├─ frontend-design/   advertisement/
│   └─ clawteam/                ← NEW (sourced from upstream at provision time)
│
├─ templates/                   ← NEW
│   ├─ genesis-coder.toml
│   └─ finance-desk.toml        (optional, gated behind --enable vibe-trading)
│
├─ agents/                      unchanged: planner/builder/reviewer/scribe.md
├─ mcp/                         unchanged: vendored MCP source for offline-able installs
├─ docs/                        + new: openclaw-daemon.md, lead-agent.md
└─ phase2/                      planning notes (this folder)
```

## Catalog file shape

Each catalog file is a small JSON manifest with consistent fields, easy to
parse from both PowerShell (`ConvertFrom-Json`) and bash (`jq`).

### `catalog/skills.json`

```json
{
  "version": 1,
  "items": [
    {
      "name": "docx",
      "source": "skills/docx",
      "install_to": "~/.claude/skills/docx",
      "tags": ["bundled", "office"]
    },
    {
      "name": "clawteam",
      "source": "remote:win4r/ClawTeam-OpenClaw/skills/openclaw/SKILL.md",
      "install_to": "~/.claude/skills/clawteam/SKILL.md",
      "also_install_to": "~/.openclaw/workspace/skills/clawteam/SKILL.md",
      "tags": ["orchestration", "required-for-agent-driven-clawteam"]
    }
  ]
}
```

### `catalog/templates.json`

```json
{
  "version": 1,
  "items": [
    {
      "name": "genesis-coder",
      "source": "templates/genesis-coder.toml",
      "install_to": "~/.clawteam/templates/genesis-coder.toml",
      "default": true
    },
    {
      "name": "finance-desk",
      "source": "templates/finance-desk.toml",
      "install_to": "~/.clawteam/templates/finance-desk.toml",
      "default": false,
      "requires": ["mcp:vibe-trading"]
    }
  ]
}
```

### `catalog/mcps.json` (replaces today's `mcp/registry.json`)

```json
{
  "version": 3,
  "items": [
    {
      "name": "fetch",
      "scope": "user",
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "default": true
    },
    {
      "name": "vibe-trading",
      "scope": "user",
      "transport": "stdio",
      "command": "uvx",
      "args": ["vibe-trading-mcp"],
      "default": false,
      "tags": ["finance"]
    }
  ]
}
```

## Wizard flag UX

Today: `-SkipSkills`, `-SkipMcps`, `-SkipOpenClaw`. These remain.

Add: `-Enable <list>` and `-Disable <list>` for fine-grained control. Names
match catalog `name` fields.

```powershell
# Default install (all `default: true` items)
.\setup\setup-genesis.ps1

# Add Vibe-Trading + finance-desk (both default:false)
.\setup\setup-genesis.ps1 -Enable vibe-trading,finance-desk

# Default install but drop Playwright
.\setup\setup-genesis.ps1 -Disable playwright

# Add OpenClaw daemon
.\setup\setup-genesis.ps1 -OpenClawDaemon
```

The wizard resolves `Enable` / `Disable` against catalog defaults, then
exports the final list to provision.sh as env vars:

```bash
GENESIS_SKILLS="docx,pdf,xlsx,pptx,frontend-design,advertisement,clawteam"
GENESIS_TEMPLATES="genesis-coder"
GENESIS_MCPS="fetch,git,playwright"
GENESIS_DAEMONS="openclaw"
```

`provision.sh` iterates the catalogs and installs only the named items.

## Migration path (no breaking changes mid-flight)

1. **Phase 2.0** — add `catalog/` and `templates/` dirs alongside the
   current ad-hoc structure. Provision.sh reads catalogs **if present**,
   falls back to current behavior otherwise. New users get the catalog
   path; existing installs keep working.

2. **Phase 2.1** — add `clawteam` skill + `genesis-coder` template +
   permissions tweak.

3. **Phase 2.2** — add `vibe-trading` MCP and `finance-desk` template
   (both opt-in via `-Enable`).

4. **Phase 2.3** — add `-OpenClawDaemon` flag, daemon install, pairing
   docs.

5. **Phase 2.4** — flip catalog from optional to required. Delete the
   legacy `mcp/registry.json` reader. Tag `v0.3.0`.

## Adding a new team after this lands

A user (or contributor) wants to add a `paper-review` team:

1. `git checkout -b add-paper-review`
2. Drop `templates/paper-review.toml` (TOML defining roles).
3. Add an entry in `catalog/templates.json`:
   ```json
   { "name": "paper-review",
     "source": "templates/paper-review.toml",
     "install_to": "~/.clawteam/templates/paper-review.toml",
     "default": false }
   ```
4. PR. Done. Wizard picks it up automatically; user installs with
   `-Enable paper-review`.

No PowerShell changes. No bash changes. Two files.

## Acceptance criteria

- [ ] All four catalog files exist and are valid JSON.
- [ ] Wizard's `-Enable` / `-Disable` resolves correctly against catalogs.
- [ ] Provision.sh reads `GENESIS_SKILLS` / `GENESIS_TEMPLATES` /
      `GENESIS_MCPS` and installs only named items.
- [ ] Default `setup-genesis.ps1` run produces the same end state as
      today's run (no regression).
- [ ] Adding a 5th template requires only `templates/foo.toml` +
      `catalog/templates.json` edit.
