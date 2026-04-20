# Genesis

> An opinionated, reproducible sandbox for running **Claude Code + OpenClaw + ClawTeam** agent swarms on Windows, with **MCP servers** and **Claude skills** installed once at user-scope and available to every project.

[![CI](https://github.com/netflypsb/genesis/actions/workflows/ci.yml/badge.svg)](https://github.com/netflypsb/genesis/actions/workflows/ci.yml)

## Why

Three agent frameworks + a code-writing CLI + MCP + skills have a dozen moving parts. Genesis:

1. **Isolates them** in a Linux sandbox (WSL2 by default, Vagrant VM as fallback) so a rogue bash tool can't touch your Windows host.
2. **Installs MCP servers at user scope** via `claude mcp add --scope user` so they appear in every project — no more per-project `.mcp.json` drift. See [docs/research.md §1](docs/research.md).
3. **Configures Ollama Cloud without an API key** by leaning on `ollama signin` + `ANTHROPIC_AUTH_TOKEN=ollama`.
4. **Bundles Claude Code skills** (`docx`, `pdf`, `xlsx`, `pptx`, `frontend-design`, `advertisement`) and drops them into `~/.claude/skills/` — globally discoverable.
5. **Uses the right ClawTeam** (`win4r/ClawTeam-OpenClaw` + `pipx install --editable`). The PyPI `clawteam` is a different package, and `npm i -g clawteam` is a name-squatter.

## Quick start

### First run (from any PowerShell window, anywhere)

```powershell
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
```

This clones the repo to `%USERPROFILE%\genesis` and launches the wizard. **You do not need to `cd` into any particular folder first** — the bootstrap works from `C:\`, `C:\Users\you`, inside another project, anywhere.

### Subsequent runs (new session, rerun, upgrade)

```powershell
cd $env:USERPROFILE\genesis
git pull
.\setup\setup-genesis.ps1
```

**Run it from `$env:USERPROFILE\genesis`, not from your project folder.** The wizard needs `provision.sh`, `Vagrantfile`, `mcp/`, `skills/`, and `agents/` sitting next to it — they all live in that folder.

### Options

```powershell
.\setup\setup-genesis.ps1                     # WSL2 backend (default)
.\setup\setup-genesis.ps1 -Mode vm            # Vagrant + VirtualBox
.\setup\setup-genesis.ps1 -Distro Ubuntu-22.04  # pick a specific distro
.\setup\setup-genesis.ps1 -SkipOpenClaw       # Claude Code + MCPs only
.\setup\setup-genesis.ps1 -SkipSkills -SkipMcps  # minimal
.\setup\setup-genesis.ps1 -AutoSignin         # run 'ollama signin' without prompting
```

### Day-to-day (after setup is done, once)

You **never re-run the wizard** for normal work. Open your project in a WSL terminal:

```powershell
wsl -d Ubuntu                    # drop into the sandbox
cd /mnt/c/path/to/your/project   # or ~/somewhere
claude                           # Claude Code inherits the global MCPs + skills
```

Or open the project folder in VS Code with the **WSL extension** — same thing.

Rerun the wizard only when:
- **upgrading Genesis** (`git pull` + rerun picks up new MCPs / skills / agents).
- **adding a new backend** (e.g., you initially installed WSL, now want the VM too).
- **recovering** from a broken install (the wizard is idempotent — safe to rerun).

## What the wizard does

| Phase | Action |
|-------|--------|
| 0 | Host capability check (OS build, RAM, CPU, PS version) |
| 1 | Ollama Desktop on Windows host (winget install + `ollama signin` if needed) |
| 2 | Backend setup: WSL2 distro (default `Ubuntu` — latest LTS) **or** Vagrant VM (8 GB / 4 CPU) |
| 3 | Runs **`provision.sh`** inside the sandbox — one script, two transports |

`provision.sh` then, inside the Linux sandbox:

1. Installs base packages (`python3.10+`, `git`, `tmux`, `curl`, `build-essential`, `jq`).
2. Installs **Node.js 22** via NodeSource.
3. Installs **`uv`** (Astral) for fast Python tool execution.
4. Installs **Claude Code** (`claude.ai/install.sh`).
5. Installs **OpenClaw** (`npm i -g openclaw`) and **ClawTeam-OpenClaw** (`git clone` + `pipx install --editable`, so it respects PEP 668 on Ubuntu 24.04).
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

**Inside the WSL sandbox** (`wsl -d Ubuntu`):

```bash
claude --version
claude mcp list              # should show fetch, git, playwright at user-scope
openclaw --version           # if you didn't pass -SkipOpenClaw
clawteam --version
ls ~/.claude/skills          # bundled skills
curl http://host.docker.internal:11434/api/tags   # WSL can reach Windows Ollama
```

**On the Windows host** (PowerShell, not WSL — Ollama runs here only):

```powershell
ollama run gpt-oss:120b-cloud "hi"   # smoke-test the cloud model
ollama whoami                         # confirm signed in
```

> Ollama is a **Windows-side daemon**. Do not `sudo snap install ollama` inside WSL — the sandbox reaches the host's Ollama at `http://host.docker.internal:11434` and that's all Claude Code needs.

## Troubleshooting

- **`bash: command not found: claude` inside WSL** — reload your shell: `exec bash -l`, or `source ~/.bashrc`.
- **`ollama signin` opens a URL the WSL terminal can't click** — copy/paste it into your Windows browser. The signin persists on the host.
- **`claude mcp list` is empty** — your Claude Code CLI may predate `--scope` support. Update: `claude upgrade`, then re-run the wizard.
- **VM `vagrant up` hangs with Hyper-V enabled** — disable Hyper-V or switch to `--provider=hyperv`. See [docs/research.md §4](docs/research.md).
- More in [docs/troubleshooting.md](docs/troubleshooting.md).

## License

MIT — see [LICENSE](LICENSE).
