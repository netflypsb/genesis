# Changelog

All notable changes to Genesis.

## [Unreleased] — phase 2 in progress

## [0.2.2] — Milestone 2.1: clawteam skill + genesis-coder template (phase2 branch)

### Added
- `skills/clawteam/SKILL.md` — vendored from upstream `win4r/ClawTeam-OpenClaw`.
  Teaches Claude Code (lead agent) how to drive `clawteam launch`, manage
  teams, spawn workers, monitor via kanban, and converge results.
- `templates/genesis-coder.toml` — 4-role parallel coding team (planner leader
  + builder + reviewer + scribe) with inline task prompts. Workers are
  `openclaw` per upstream guidance (claude workers stall on permission prompts).
- `catalog/skills.json` — adds `clawteam` skill entry. Supports
  `also_install_to` field so the skill installs to both `~/.claude/skills/`
  and (if present) `~/.openclaw/workspace/skills/`.
- `catalog/templates.json` — populated with `genesis-coder` entry.
- `provision.sh` Phase 9 now merges `permissions.allow` into
  `~/.claude/settings.json` with: `Bash(clawteam *)`, `Bash(tmux *)`,
  `Bash(git status|diff|log|branch *)`, `Bash(ls *)`, `Read`. Merge
  semantics: preserves pre-existing user entries, no duplicates. This
  unlocks **Path B** (agent-driven ClawTeam) — Claude no longer pauses for
  approval when the skill invokes `clawteam` / `tmux`.
- `scripts/test-permissions-merge.sh` — regression guard for the merge
  logic. Asserts user entries survive, Genesis entries added, no dupes.
- CI: `catalog-validate` job now runs the permissions-merge test too.

### Changed
- `provision.sh` Phase 8 (skills) honors an optional `also_install_to`
  field on any skill item. If the secondary destination's parent already
  exists (e.g. OpenClaw workspace), the skill is mirrored there.

## [0.2.1] — Milestone 2.0: catalog foundation (phase2 branch)

### Added
- `catalog/` directory with four manifest files: `skills.json`, `mcps.json`,
  `agents.json`, `templates.json`. Each is the single source of truth for
  what the provisioner installs. Documented in `catalog/README.md`.
- `setup-genesis.ps1` learns `-Enable <names>` and `-Disable <names>` flags
  (comma-separated) that override each catalog item's `default` field.
  Passed to provision.sh as `GENESIS_ENABLE` / `GENESIS_DISABLE`.
- `provision.sh` Phases 7 (MCPs), 8 (skills), 10 (agents + clawteam
  templates) now iterate their catalog files via jq. Legacy fallback
  preserved: if `catalog/` is missing, the old hardcoded behavior runs
  unchanged.
- `scripts/validate-catalog.sh` — parses each catalog, enforces schema,
  checks every `source` path resolves.
- `scripts/test-catalog-reader.sh` — smoke-test of the enable/disable
  resolution logic against fixtures.
- CI jobs: `catalog-validate`, `provision-syntax` (bash -n + shellcheck
  errors-only on `provision.sh` and `scripts/*.sh`).
- Vagrantfile forwards `GENESIS_ENABLE` / `GENESIS_DISABLE` / skip flags
  from the host shell into the VM provisioner, so VM-mode respects the
  same wizard flags as WSL-mode.

### Changed
- `provision.sh` default behavior with catalog present is byte-identical
  to v0.2.0: same 6 skills, 3 MCPs, 4 agents installed. Verified by
  `test-catalog-reader.sh`.

### Not yet changed
- `mcp/registry.json` still exists but is no longer read by the
  provisioner. Scheduled for removal in milestone 2.4 (tag `v0.3.0`).

## [0.2.0] — Phase 1 release (main)

### Added
- Initial repo scaffold: `setup/`, `mcp/`, `agents/`, `templates/`, `vendor/`, `config/`, `docs/`, `.github/workflows/`.
- `setup/setup-clawteam-wsl.ps1` v3.0 - 7-phase wizard with MCP auto-install and Ollama Cloud default.
- `setup/bootstrap.ps1` - one-liner entry point.
- `setup/lib/` - shared PS helpers (`common.ps1`, `wsl.ps1`, `mcp.ps1`).
- `mcp/registry.json` - MCP server manifest (playwright, fetch, git, k-01).
- `agents/*.md` - planner / builder / reviewer / scribe sub-agents.
- `config/settings.sample.json` - reference Claude settings.
- `docs/wsl-networking.md`, `docs/ollama-cloud.md`, `docs/troubleshooting.md`.
- CI: PSScriptAnalyzer + JSON validation.

### Fixed (vs legacy `setup-clawteam-wsl.ps1` v2)
- Dropped bogus `clawteam preset generate-profile` call (ClawTeam uses **templates**, not presets).
- Replaced fragile `printf '$pyJoined\n'` heredoc with clean `Write-WslFile` + `wslpath`.
- Ollama Cloud now defaults to localhost:11434 (no API key) via local desktop app, matching the verified `setup-claude.ps1` approach.
- Detects WSL networking mode; falls back to `host.docker.internal:11434` when mirrored mode is off.
- Installs `uv`, `playwright chromium`, and idempotent PATH entries.

## [0.0.1] - reference snapshot
- Original `setup-claude.ps1` and `setup-clawteam-wsl.ps1` kept at repo root for reference.
