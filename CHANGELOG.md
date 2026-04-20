# Changelog

All notable changes to Genesis.

## [Unreleased]

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
