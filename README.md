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

Three distinct commands — use the right one for the job.

### 1. First install — run once per machine

```powershell
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
```

From **any** PowerShell window, **any** directory. The bootstrap clones the repo to `%USERPROFILE%\genesis` and launches the wizard. Expect ~15–20 min the first time (Ubuntu download, apt packages, npm globals, Playwright Chromium).

### 2. Daily use — run every coding session

```powershell
wsl -d Ubuntu                    # drop into the Linux sandbox
```

Then inside WSL:

```bash
cd ~/projects/your-project       # or /mnt/c/Users/you/your-project (slower)
claude                           # Claude Code, pre-wired with MCPs + skills + Ollama
# or
clawteam launch code-review --goal "..." --workspace --repo .
```

Or in VS Code: install the **WSL extension** → "Reopen in WSL" → terminal gives you `claude` directly.

**You never re-run the wizard for daily work.** It's only for install, upgrade, or recovery.

### 3. Upgrade / re-run the wizard — run rarely

```powershell
cd $env:USERPROFILE\genesis
git pull
.\setup\setup-genesis.ps1
```

**Run from `$env:USERPROFILE\genesis`, not your project folder.** The wizard needs `provision.sh`, `Vagrantfile`, `mcp/`, `skills/`, `agents/` sitting next to it. Trigger this only when:

- a new Genesis release adds MCPs / skills / teams you want,
- you're switching backends (WSL ↔ Vagrant VM),
- you need to recover a broken install (wizard is idempotent).

### Wizard options

```powershell
.\setup\setup-genesis.ps1                     # WSL2 backend (default)
.\setup\setup-genesis.ps1 -Mode vm            # Vagrant + VirtualBox fallback
.\setup\setup-genesis.ps1 -Distro Ubuntu-22.04  # pick a specific distro
.\setup\setup-genesis.ps1 -SkipOpenClaw       # Claude Code + MCPs only
.\setup\setup-genesis.ps1 -SkipSkills -SkipMcps  # minimal
.\setup\setup-genesis.ps1 -AutoSignin         # auto-run `ollama signin`
```

## Two Claude Codes? Use the WSL one.

You may have an older Claude Code install on Windows (`C:\Users\you\.claude\`). That's a **completely separate** process from the Claude Code that Genesis installs inside WSL (`/home/you/.claude/`). They don't share MCPs, skills, or settings. **For Genesis, always use the WSL one** — just run `claude` after `wsl -d Ubuntu`.

## Your projects — inside or outside WSL?

| Location | Path from WSL | Speed | Accessible from Windows? |
|---|---|---|---|
| `~/projects/my-app` (inside WSL ext4) | `/home/you/projects/my-app` | **fast** | yes, via `\\wsl$\Ubuntu\home\you\projects\...` |
| `C:\Users\you\code\my-app` (Windows NTFS) | `/mnt/c/Users/you/code/my-app` | ~10× slower for many small files | natively |

For heavy agent work (lots of file writes), clone to `~/projects/`. For projects you edit from both Windows apps and WSL, put them under `C:\Users\you\...` and accept the I/O cost.

## Launching ClawTeam — two paths

### Path A: you drive it (CLI)

```bash
wsl -d Ubuntu
cd ~/projects/my-repo
clawteam launch code-review --goal "Review for bugs + perf" --workspace --repo .
```

### Path B: an agent drives it (needs the `clawteam` skill)

```bash
wsl -d Ubuntu
claude
# In Claude: "Use clawteam to spin up a code-review team on this repo."
```

Claude reads `~/.claude/skills/clawteam/SKILL.md` and runs the CLI itself.

> **Status:** Path A works today. Path B needs the `clawteam` skill, which arrives in Genesis `v0.2.2` — see [`phase2/`](phase2/) planning.

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
