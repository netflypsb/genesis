# Changelog

All notable changes to Genesis.

## [0.3.0] — Phase 2 complete (2026-04-21)

Catalog-driven provisioning is now the only code path. Genesis repo is
fully modular: teams, skills, MCPs, and agents are all installed from
`catalog/*.json` entries the wizard reads at install time.

### Removed (breaking)
- Legacy `mcp/registry.json` deleted. The authoritative MCP manifest is
  now `catalog/mcps.json` — has been since v0.2.1 but the old file lingered.
- Legacy fallback paths in `provision.sh` for missing `catalog/mcps.json`
  or `catalog/skills.json` — now a fatal error ("re-clone Genesis").
  Rationale: silent drift between catalog and hardcoded lists caused
  hard-to-diagnose issues during M2.2 development.

### Migration for v0.2.x users
- Existing installs keep working; `~/.claude/*`, `~/.clawteam/*`, and
  registered MCPs are untouched.
- On next `vagrant provision` / `setup-genesis.ps1` run, the new code
  path installs identically to the catalog contents.
- No manual action needed unless you had local edits to
  `mcp/registry.json` (file no longer exists — port to `catalog/mcps.json`).

## [0.2.5] — Milestone 2.3 (OpenClaw daemon, partial)

### Added — Milestone 2.3 (phase2-m2.3 branch, partial — tracked as v0.2.5)

**Known limitation:** `openclaw onboard --non-interactive` inside the VM
fails its Ollama probe under VirtualBox NAT (Node.js fetch quirk — `curl`
works, Node's bundled fetch doesn't, despite `--custom-base-url`). Genesis
provision completes successfully and `gateway: inactive` is reported in
the summary. The rest of Genesis (Claude Code, ClawTeam, skills, agents,
MCPs) is unaffected. Workaround: run `openclaw onboard` manually inside
`vagrant ssh` (interactive mode uses a different probe path).


- **OpenClaw gateway daemon** opt-in via new `-OpenClawDaemon` wizard flag.
  Installs `openclaw-gateway.service` as a `systemctl --user` unit
  inside the sandbox, enables `loginctl enable-linger` so the daemon
  survives logout, and probes `127.0.0.1:18789` for liveness.
- New `provision.sh` Phase 5d runs
  `openclaw onboard --install-daemon --non-interactive --auth-choice ollama`
  with `--skip-channels/search/ui/health` so provisioning never blocks.
- Vagrantfile forwards `GENESIS_OPENCLAW_DAEMON` into the VM.
- Provision summary now shows `gateway: active|inactive|not-installed`.
- New `docs/openclaw-daemon.md` with full Telegram pairing walkthrough
  (BotFather -> channels login -> pairing approve -> first DM test),
  daily ops commands, security model, troubleshooting, and uninstall.
- Refined `phase2/03-openclaw-daemon-plan.md` for the VM-first world
  (native systemd, no `/etc/wsl.conf` dance required).

### Added — Milestone 2.2 (phase2-teams branch, 2026-04-21)
- **Provider wizard (`setup/setup-provider.ps1`)**: backend-agnostic AI
  provider + model picker. Auto-detects WSL or VM sandbox. Fetches model
  lists dynamically from OpenRouter (`/api/v1/models`), Anthropic
  (`/v1/models`), and Ollama Local (`/api/tags`). Curated list for Ollama
  Cloud. Preserves existing permissions/MCPs/skills in settings.json,
  only rewrites the `env` block. Auto-starts VM if halted. Backs up to
  `settings.json.bak`.
- **Surfaced 4 upstream ClawTeam teams** in `catalog/templates.json` via
  new `upstream: true` flag: `code-review`, `hedge-fund`, `research-paper`,
  `strategy-room`. No install required (already bundled with clawteam
  pipx); catalog now documents their roles + use cases.
- **New Genesis team templates**:
  - `finance-desk` (opt-in): analyst → strategist → backtester pipeline
    using Vibe-Trading MCP's 16 finance tools.
  - `deep-research` (opt-in): searcher → reader → synthesizer literature
    review pipeline using fetch + playwright MCPs.
- **New opt-in MCPs in `catalog/mcps.json`**:
  - `vibe-trading` — installs `vibe-trading-ai` via pipx, registers
    `vibe-trading-mcp` at user scope.
  - `k-01` — clones netflypsb/K-01, npm installs + builds, registers
    `node <path>/dist/server.js` at user scope (58 tools for document +
    codebase intelligence).
- **Provision.sh MCP install block**: new `install.kind` field supporting
  `pipx` and `git-node` install strategies with automatic dependency
  installation inside the sandbox.

### Deprecated
- `setup/setup-clawteam-wsl.ps1` — WSL-only legacy wizard, shows a 5s
  deprecation banner pointing to setup-genesis.ps1 + setup-provider.ps1.

### Fixed (wizard UX — 2026-04-21)
- Wizard no longer bails when `ollama`, `VBoxManage`, or `vagrant` are
  installed but not yet on PATH. New `Resolve-Tool` helper probes
  standard install locations (e.g. `%LocalAppData%\Programs\Ollama`,
  `%ProgramFiles%\Oracle\VirtualBox`, `%ProgramFiles%\Vagrant\bin`) and
  heals both the session PATH and the persistent user PATH.
- `Install-Tool` helper falls back to a direct-download URL when
  `winget` is unavailable (older Windows / Store install missing).
- Hyper-V detection no longer requires admin: falls back to
  `bcdedit /enum` when `Get-WindowsOptionalFeature` fails.

## [0.2.4] — Milestone 2.5: VM-first enablement (phase2 branch)

### Added
- Wizard: `-VMFirst` flag (implies `-Mode vm`). After `vagrant up`:
  - Exports SSH config to `~/.ssh/config.d/genesis` with alias `genesis-vm`.
  - Ensures `~/.ssh/config` has `Include config.d/*` (safe, idempotent).
  - Writes `~/.genesis/vm-config.json` for helper scripts to consume.
  - Prints VM-first-tailored next-steps covering daily flow, VS Code
    Remote-SSH, snapshots, and lifecycle commands.
- Wizard: `-SyncProjects <path>` flag (opt-in). Mounts a Windows directory
  into the VM at `/home/vagrant/shared-projects`. Default: no host dirs
  mounted — the whole point of VM-first is isolation.
- `scripts/open-vm-in-vscode.ps1` — brings up the VM if halted, refreshes
  the ssh config, ensures Remote-SSH extension is installed, then launches
  VS Code on `/home/vagrant/projects` (or a path you pass).
- `docs/vm-snapshots.md` — snapshot workflow for rewinding risky agent
  runs in ~1 minute.
- `provision.sh` Phase 10b (new): creates `~/projects/` inside the VM with
  a README hint. Guards with `GENESIS_VM_MODE` auto-detection.

### Changed
- `Vagrantfile` rewritten:
  - Upgraded from `ubuntu/jammy64` (22.04) to `bento/ubuntu-24.04`.
  - `/vagrant` now mounted **read-only** so agents can't scribble into
    the Windows-side Genesis checkout.
  - Memory / CPU / VM name overridable via `GENESIS_VM_MEMORY`,
    `GENESIS_VM_CPUS`, `GENESIS_VM_NAME` env vars.
  - `config.ssh.forward_agent = true` so host SSH agent (GitHub keys)
    flows into the VM — `git push` works without PATs or copied keys.
  - Forwards `GENESIS_VM_MODE=1` to provision.sh so Phase 10b fires.
  - Optional Windows sync via `GENESIS_SYNC_PROJECTS` env var.
- `provision.sh` auto-detects VM mode (`/etc/vagrant_box.info`,
  `USER=vagrant`, `/vagrant` presence). Runs Phase 10b automatically in
  both `-Mode vm` and `-VMFirst` paths.

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
