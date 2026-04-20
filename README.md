# Genesis

> An opinionated, reproducible sandbox for running **Claude Code + OpenClaw + ClawTeam** agent swarms on Windows, with **MCP servers** and **Claude skills** installed once at user-scope and available to every project.

[![CI](https://github.com/netflypsb/genesis/actions/workflows/ci.yml/badge.svg)](https://github.com/netflypsb/genesis/actions/workflows/ci.yml)

## Why

Three agent frameworks + a code-writing CLI + MCP + skills have a dozen moving parts. Genesis:

1. **Isolates them** in a Linux sandbox (WSL2 by default, Vagrant VM as fallback) so a rogue bash tool can't touch your Windows host.
2. **Installs MCP servers at user scope** via `claude mcp add --scope user` so they appear in every project — no more per-project `.mcp.json` drift. See [docs/research.md §1](docs/research.md).
3. **Configures Ollama Cloud without an API key** by leaning on `ollama signin` + `ANTHROPIC_AUTH_TOKEN=ollama`.
4. **Bundles Claude Code skills** (`docx`, `pdf`, `xlsx`, `pptx`, `frontend-design`, `advertisement`) and drops them into `~/.claude/skills/` — globally discoverable.
5. **Uses the right ClawTeam** (`win4r/ClawTeam-OpenClaw` + `pip install -e .`). The PyPI `clawteam` is a different package, and `npm i -g clawteam` is a name-squatter.

## Quick start

```powershell
# One-liner
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex

# Or clone and run
git clone https://github.com/netflypsb/genesis.git $env:USERPROFILE\genesis
cd $env:USERPROFILE\genesis
.\setup\setup-genesis.ps1                 # WSL2 backend (default)
.\setup\setup-genesis.ps1 -Mode vm        # Vagrant + VirtualBox backend
```

## What the wizard does

| Phase | Action |
|-------|--------|
| 0 | Host capability check (OS build, RAM, CPU, PS version) |
| 1 | Ollama Desktop on Windows host (winget install + `ollama signin` if needed) |
| 2 | Backend setup: WSL2 distro (default `Ubuntu-24.04`) **or** Vagrant VM (8 GB / 4 CPU) |
| 3 | Runs **`provision.sh`** inside the sandbox — one script, two transports |

`provision.sh` then, inside the Linux sandbox:

1. Installs base packages (`python3.10+`, `git`, `tmux`, `curl`, `build-essential`, `jq`).
2. Installs **Node.js 22** via NodeSource.
3. Installs **`uv`** (Astral) for fast Python tool execution.
4. Installs **Claude Code** (`claude.ai/install.sh`).
5. Installs **OpenClaw** (`npm i -g openclaw`) and **ClawTeam-OpenClaw** (`git clone` + `pip install -e .`).
6. Installs **Playwright Chromium** (eager; ~300 MB).
7. Registers three MCP servers at **user-scope**: `fetch`, `git`, `playwright` — visible in every project via `claude mcp list`.
8. Copies bundled skills → `~/.claude/skills/`.
9. Writes Ollama Cloud env into `~/.claude/settings.json`.
10. Copies agent role prompts → `~/.claude/agents/`.

## Backends at a glance

| | **WSL2** (default) | **Vagrant VM** |
|---|---|---|
| Boot time | seconds | minutes |
| Isolation | process + separate FS | hardware-level |
| Host access | `/mnt/c/*` visible | only via `synced_folder` |
| RAM cost | demand-paged | 8 GB fixed |
| Requires | Win 10 build 19041+ | VirtualBox + Vagrant |
| Hyper-V conflict | — | degrades perf; consider disabling |

See [docs/research.md §4](docs/research.md) for the full tradeoff.

## Repo layout

```
genesis/
├─ setup/                  # PowerShell wizard + shared libs
│  ├─ setup-genesis.ps1    # main wizard (v0.2.0)
│  ├─ bootstrap.ps1        # one-liner entry point
│  └─ lib/                 # common.ps1, wsl.ps1, mcp.ps1
├─ provision.sh            # shared Linux installer (WSL + VM)
├─ Vagrantfile             # VM fallback config
├─ mcp/                    # MCP registry + vendored sources (flattened)
├─ agents/                 # planner/builder/reviewer/scribe prompts
├─ skills/                 # Claude Code skills (docx, pdf, xlsx, ...)
├─ config/                 # sample settings.json
├─ docs/                   # research, WSL notes, troubleshooting
└─ .github/workflows/      # CI
```

## Verification

After the wizard finishes, inside the sandbox:

```bash
claude --version
claude mcp list              # should show fetch, git, playwright at user-scope
openclaw --version           # if you didn't pass -SkipOpenClaw
clawteam --version
clawteam config health
ls ~/.claude/skills          # bundled skills
```

## Troubleshooting

- **`bash: command not found: claude` inside WSL** — reload your shell: `exec bash -l`, or `source ~/.bashrc`.
- **`ollama signin` opens a URL the WSL terminal can't click** — copy/paste it into your Windows browser. The signin persists on the host.
- **`claude mcp list` is empty** — your Claude Code CLI may predate `--scope` support. Update: `claude upgrade`, then re-run the wizard.
- **VM `vagrant up` hangs with Hyper-V enabled** — disable Hyper-V or switch to `--provider=hyperv`. See [docs/research.md §4](docs/research.md).
- More in [docs/troubleshooting.md](docs/troubleshooting.md).

## License

MIT — see [LICENSE](LICENSE).
