# Phase 2 roadmap

## Sequencing

Each milestone is a self-contained PR + tag. None blocks the others
strictly, but the order minimizes rework.

| Milestone | Tag | Effort | Blockers |
|---|---|---|---|
| **2.0 — Catalog foundation** | `v0.2.1` | S | none |
| **2.1 — `clawteam` skill + `genesis-coder` template + perms** | `v0.2.2` | S | 2.0 |
| **2.2 — Vibe-Trading MCP + `finance-desk` template (opt-in)** | `v0.2.3` | S | 2.0 |
| **2.5 — VM-first enablement** (see [`06-vm-first-workflow.md`](06-vm-first-workflow.md)) | `v0.2.4` | M | none |
| **2.3 — OpenClaw daemon + pairing docs** | `v0.2.5-rc1` | M | 2.1, 2.5 (VM recommended) |
| **2.4 — Catalog promoted to required; legacy paths removed** | `v0.3.0` | S | 2.0–2.3, 2.5 |

Effort key: S = ≤1 session of work, M = 2-4 sessions.

## Milestone 2.0 — Catalog foundation

**Deliverables:**

- `catalog/{skills,templates,mcps,agents}.json` with current state encoded.
- `provision.sh` learns to read these catalogs (gated; legacy fallback if
  `catalog/` is missing).
- `setup-genesis.ps1` learns `-Enable`/`-Disable` flags.
- Migration is a no-op for existing users.

**Acceptance:**

- A fresh `iwr | iex` produces the same end state as `v0.2.0` did.
- `cat catalog/skills.json | jq '.items[].name'` lists all 6 current
  skills.

**Tag `v0.2.1` once green.**

## Milestone 2.1 — `clawteam` skill + `genesis-coder` template

**Deliverables:**

- `templates/genesis-coder.toml` referencing `agents/{planner,builder,
  reviewer,scribe}.md`.
- `catalog/skills.json` adds `clawteam` (sourced from upstream OpenClaw
  install path: `$HOME/ClawTeam-OpenClaw/skills/openclaw/SKILL.md`).
- `catalog/templates.json` adds `genesis-coder` (default: true).
- Phase 9 settings.json writer extends `permissions.allow` with
  `Bash(clawteam *)`, `Bash(tmux *)`.
- `docs/agent-driven-clawteam.md` walks through "say to claude: 'use
  clawteam to …'".

**Acceptance:**

- Fresh install → `claude mcp list` unchanged, `clawteam template list`
  includes `genesis-coder`.
- `claude` session: typing "Use clawteam to spin up a genesis-coder team
  on this empty repo with goal 'add a Hello World python script'"
  successfully launches a tmux session **without** Claude pausing for
  permission.

**Tag `v0.2.2`.**

## Milestone 2.2 — Vibe-Trading

**Deliverables:**

- `catalog/mcps.json` adds `vibe-trading` (default: false; tag `finance`).
- `templates/finance-desk.toml` — small 3-role team using vibe-trading
  MCP tools.
- `docs/vibe-trading.md` — what tools are available, how to invoke from
  agent prompts.

**Acceptance:**

- `setup-genesis.ps1 -Enable vibe-trading,finance-desk` installs both.
- `claude mcp list` shows `vibe-trading` after.
- `clawteam launch finance-desk --goal "..."` runs without missing-tool
  errors.

**Tag `v0.2.3`.**

## Milestone 2.3 — OpenClaw daemon

**Deliverables:**

- `setup-genesis.ps1 -OpenClawDaemon` flag.
- Provision.sh new phase: `Phase 11 — OpenClaw daemon (optional)`:
  - Ensures `/etc/wsl.conf` has `[boot]\nsystemd=true`.
  - Runs `openclaw onboard --install-daemon`.
  - Confirms `~/.openclaw/workspace/skills/clawteam/SKILL.md` exists.
- `docs/openclaw-daemon.md` — pairing walkthrough for Telegram + Discord
  (the two most common channels).
- Optional: Windows scheduled task that runs `wsl -d Ubuntu -- true` at
  user logon to keep distro warm. Behind a separate `-AutostartWSL` flag.

**Acceptance:**

- `systemctl --user status openclaw` returns `active` after install (post
  `wsl --shutdown` once for systemd).
- DMing a paired bot with "clawteam team list" yields the team list reply.

**Tag `v0.3.0-rc1`.**

## Milestone 2.4 — Promote catalog, cut `v0.3.0`

**Deliverables:**

- Remove the legacy fallback path in provision.sh (catalog now required).
- Remove `mcp/registry.json` (replaced by `catalog/mcps.json`).
- README updated end-to-end with the new flags.
- `CHANGELOG.md` documenting the catalog migration.

**Tag `v0.3.0`.** Announce.

## Out of scope for phase 2 (deferred to phase 3+)

- YAML→TOML transpiler for all 29 Vibe-Trading swarm presets.
- ClawTeam Redis transport (depends on upstream `v0.4`).
- Multi-tenant OpenClaw.
- Web dashboard beyond `clawteam board serve`.
- Direct Claude Code → ClawTeam Python bindings (no upstream support).

## Risks

- **Upstream API drift.** ClawTeam template TOML schema may evolve;
  `clawteam` skill instructions could change. Mitigation: pin
  `ClawTeam-OpenClaw` to a known-good commit in provision.sh's `git
  clone` step (already `--depth 1` of `main`; consider locking to a tag
  in 2.4).
- **Vibe-Trading MCP packaging.** `uvx vibe-trading-mcp` may not exist on
  PyPI under that name today — verify before 2.2 ships. If unavailable,
  fall back to a `git clone + uvx --from .` install path.
- **Systemd inside WSL.** Some users disable it. The wizard must detect
  and bail gracefully with an actionable error.

## Definition of done for phase 2 overall

A new contributor can:

1. Run the one-liner.
2. Run `clawteam launch genesis-coder --goal "..."` and watch a 4-pane
   tmux session of Claudes coordinate.
3. Optionally `setup-genesis.ps1 -OpenClawDaemon` and DM their daemon
   from Telegram to spawn teams remotely.
4. Add a new team by writing one TOML and one JSON entry.
