# Genesis

> The most powerful CLI creation tool — a versioned, reproducible setup for ClawTeam agent swarms on top of Claude Code, with pre-configured MCP servers available to every spawned agent.

Genesis is a Windows-first, WSL-backed bootstrap for:

- **Claude Code** (Anthropic CLI) as the primary agent runtime
- **ClawTeam** (HKUDS) as the agent orchestrator
- **Ollama Cloud** as the default model provider (no API key required)
- **MCP servers** (`playwright`, `fetch`, `git`, and more) pre-installed and available to every agent ClawTeam spawns
- **Versioned templates, agents, and MCP sources** stored in this repo so upstream breakage can't strand you

## Quick start

```powershell
# One-liner bootstrap (run in Windows PowerShell 5.1+ or 7+)
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
```

Or clone and run:

```powershell
git clone https://github.com/netflypsb/genesis.git
cd genesis
.\setup\setup-clawteam-wsl.ps1
```

## What the wizard does

1. **Self-check** — PowerShell version, WSL availability, WSL networking mode.
2. **Requirements scan** — `python3.10+`, `pip`, `tmux`, `git`, `node 20+`, `uv`, `claude`, `clawteam` inside WSL.
3. **Install missing** — apt packages, NodeSource, Astral `uv` installer, `@anthropic-ai/claude-code`, `clawteam`, Playwright Chromium.
4. **Provider config** — default: **Ollama Cloud, no API key** (via local Ollama desktop app). Alternatives: OpenRouter, Anthropic, Ollama Local, MiniMax.
5. **MCP servers** — installs `playwright`, `fetch`, `git` by default into WSL `~/.claude/settings.json` so every Claude-based agent inherits them.
6. **Agent team files** — drops `planner` / `builder` / `reviewer` / `scribe` into `~/.claude/agents/`.
7. **ClawTeam team launch** — pick leader/worker (Claude by default), backend (tmux), optionally spawn a starter team.
8. **Verification** — `claude --version`, `claude mcp list`, `clawteam team list`.

## Repo layout

```
genesis/
├─ setup/            # wizard + shared libs
├─ mcp/              # vendored MCP server sources + registry.json
├─ agents/           # Claude sub-agent markdown files
├─ templates/        # ClawTeam team templates
├─ vendor/           # pinned upstream sources (fallback)
├─ config/           # sample config files
├─ docs/             # handbook, WSL notes, troubleshooting
└─ plan01/           # design notes
```

See `@/Users/netfl/SKYNET/genesis/plan01/README.md` for the full design doc.

## License

MIT (see `LICENSE`).
