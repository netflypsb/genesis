# Genesis

> An opinionated, reproducible sandbox for running **Claude Code + OpenClaw + ClawTeam** agent swarms on Windows, with **MCP servers** and **Claude skills** installed once at user-scope and available to every project.

[![CI](https://github.com/netflypsb/genesis/actions/workflows/ci.yml/badge.svg)](https://github.com/netflypsb/genesis/actions/workflows/ci.yml)

## Why

Three agent frameworks + a code-writing CLI + MCP + skills have a dozen moving parts. Genesis:

1. **Isolates them** in a Linux sandbox (WSL2 or Vagrant VM) so a rogue bash tool can't touch your Windows host.
2. **Installs MCP servers at user scope** via `claude mcp add --scope user` so they appear in every project — no more per-project `.mcp.json` drift.
3. **Configures Ollama Cloud without an API key** by leaning on `ollama signin` + `ANTHROPIC_AUTH_TOKEN=ollama`.
4. **Bundles Claude Code skills** (`docx`, `pdf`, `xlsx`, `pptx`, `frontend-design`, `advertisement`, `clawteam`) — globally discoverable.
5. **Uses the right ClawTeam** (`win4r/ClawTeam-OpenClaw` + `pipx install --editable`).

## Which backend should I pick?

| | **WSL** (default) | **VM-first** (recommended for heavy use) |
|---|---|---|
| Boot time | seconds | ~60s first time, 20s after |
| Isolation | process-level, shared kernel with Windows | hardware-level (VirtualBox) |
| Host FS access | `/mnt/c/...` visible | none unless you opt-in with `-SyncProjects` |
| RAM cost | demand-paged | 8 GB reserved |
| Best for | quick start, light editing, Windows/Linux interop | multi-agent swarms, daemons, risky runs, snapshot/rewind |
| Requires | Win 10 build 19041+ | VirtualBox + Vagrant |

**Unsure?** Start with WSL. You can run `-VMFirst` later without touching the WSL install.

---

## WSL backend

### 🚀 First-time install

From **any** PowerShell window, **any** directory:

```powershell
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
```

This clones the repo to `%USERPROFILE%\genesis` and runs the wizard. Expect **~15–20 min** (Ubuntu download, apt packages, npm globals, Playwright Chromium).

When it finishes you'll have `claude`, `openclaw`, `clawteam`, 7 skills, 4 agents, 1 template, and 5 MCPs all wired up inside WSL's Ubuntu.

### 📅 Daily use

```powershell
wsl -d Ubuntu
```

Then inside WSL:

```bash
cd ~/projects/my-app                    # fast (native ext4)
# OR for a Windows-side project:
cd /mnt/c/Users/you/code/my-app         # ~10× slower, but shared with Windows apps

claude                                  # Claude Code, pre-wired with MCPs + skills
```

You **do not re-run the wizard** for daily coding. Just `wsl -d Ubuntu`.

Prefer VS Code? Install the **Remote - WSL** extension → "Reopen folder in WSL" → terminal in that window gives you `claude` directly.

### 🔄 Updating Genesis (new skills / MCPs / fixes)

```powershell
cd $env:USERPROFILE\genesis
git pull
.\setup\setup-genesis.ps1
```

The wizard is idempotent — re-runs are fast because it skips already-installed pieces. Only re-run when:

- a new Genesis release adds MCPs / skills / teams you want,
- you're switching backends (WSL ↔ VM),
- you need to recover a broken install.

### 📝 WSL backend — all-in-one cheat sheet

```powershell
# First time (any directory)
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex

# Every day
wsl -d Ubuntu

# Update (once in a while)
cd $env:USERPROFILE\genesis; git pull; .\setup\setup-genesis.ps1
```

---

## VM-first backend

Full isolation, native ext4 performance, snapshot/restore, VS Code Remote-SSH auto-wired.

### 🚀 First-time install

**Prerequisites:** install **VirtualBox** and **Vagrant** once.

```powershell
# Check if already installed
VBoxManage --version; vagrant --version
```

If missing: [VirtualBox](https://www.virtualbox.org/wiki/Downloads) + [Vagrant](https://developer.hashicorp.com/vagrant/downloads) — both have standard Windows installers. Reboot after to finalize drivers.

Then:

```powershell
cd $env:USERPROFILE                                # or anywhere
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 -OutFile bootstrap.ps1
# Edit the file OR use the cloned repo directly:
cd $env:USERPROFILE\genesis                        # after first clone
.\setup\setup-genesis.ps1 -VMFirst
```

Or in one go if you've never cloned:

```powershell
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
# Then after the clone happens:
cd $env:USERPROFILE\genesis
.\setup\setup-genesis.ps1 -VMFirst
```

Expect **~25–35 min** first time (Ubuntu 24.04 box download ~1 GB + provisioning).

The wizard will:
1. Detect + install Ollama / VirtualBox / Vagrant if missing (winget or direct download).
2. `vagrant up` — boots the Ubuntu 24.04 VM.
3. Runs provisioning inside the VM (same as WSL).
4. Exports SSH config to `~/.ssh/config.d/genesis` with alias `genesis-vm`.
5. Writes `~/.genesis/vm-config.json` for helper scripts.

### 📅 Daily use

```powershell
cd $env:USERPROFILE\genesis
vagrant up                                        # ~20s to resume if halted

# Option A: plain terminal
vagrant ssh
# Inside VM:
cd ~/projects/my-app && claude

# Option B: VS Code Remote-SSH (recommended)
.\scripts\open-vm-in-vscode.ps1                   # opens ~/projects in VS Code
# OR a specific path:
.\scripts\open-vm-in-vscode.ps1 /home/vagrant/projects/my-app
```

End of day:

```powershell
vagrant halt                                      # preserves VM state
```

### 🔄 Updating Genesis

```powershell
cd $env:USERPROFILE\genesis
git pull
vagrant provision                                 # re-runs installer inside the VM (fast)
```

Or re-run the full wizard if you want the ssh config refreshed too:

```powershell
.\setup\setup-genesis.ps1 -VMFirst
```

### 📸 Snapshots — rewind before risky agent runs

```powershell
cd $env:USERPROFILE\genesis
vagrant snapshot save pre-agent-run
# ... run something risky (agent does `rm -rf /`, etc.) ...
vagrant snapshot restore pre-agent-run            # back to safety in ~1 min

vagrant snapshot list
vagrant snapshot delete pre-agent-run             # when you don't need it anymore
```

Full snapshot workflow: [`docs/vm-snapshots.md`](docs/vm-snapshots.md).

### 📝 VM-first backend — all-in-one cheat sheet

```powershell
# First time
cd $env:USERPROFILE\genesis                       # or bootstrap first
.\setup\setup-genesis.ps1 -VMFirst

# Every day
cd $env:USERPROFILE\genesis; vagrant up; .\scripts\open-vm-in-vscode.ps1

# Stop for the day
cd $env:USERPROFILE\genesis; vagrant halt

# Update
cd $env:USERPROFILE\genesis; git pull; vagrant provision

# Snapshot / restore
cd $env:USERPROFILE\genesis; vagrant snapshot save <name>
cd $env:USERPROFILE\genesis; vagrant snapshot restore <name>

# Nuke and start over
cd $env:USERPROFILE\genesis; vagrant destroy -f
```

### VS Code Remote-SSH setup

If `.\scripts\open-vm-in-vscode.ps1` reports **`code` CLI not found**:

1. Open VS Code (Start menu).
2. <kbd>F1</kbd> → type **`Shell Command: Install 'code' command in PATH`** → Enter.
3. Close PowerShell, reopen.
4. `.\scripts\open-vm-in-vscode.ps1` now works.

Or manually: open VS Code → <kbd>F1</kbd> → `Remote-SSH: Connect to Host…` → pick `genesis-vm`.

---

## AI provider + model picker

By default, Genesis wires Claude Code to **Ollama Cloud** via your Windows Ollama daemon — no key, but requires `ollama signin`. To switch provider or pin specific models, run the **provider wizard**:

```powershell
cd $env:USERPROFILE\genesis
.\setup\setup-provider.ps1                         # auto-detects WSL or VM
.\setup\setup-provider.ps1 -Backend vm             # force VM
.\setup\setup-provider.ps1 -Backend wsl            # force WSL
.\setup\setup-provider.ps1 -Provider openrouter    # skip provider prompt
```

Supported providers with **dynamic model listing** (pulled live from each provider's API):

| Provider | Dynamic model list | Key? | Notes |
|---|---|---|---|
| **Ollama Cloud** | curated + your cached `:cloud` models | no | `ollama signin` must be done on Windows |
| **OpenRouter** | ✅ `GET /api/v1/models` (300+ models) | yes | sk-or-... from https://openrouter.ai/keys |
| **Anthropic** | ✅ `GET /v1/models` | yes | official endpoint, paid |
| **Ollama Local** | ✅ `GET /api/tags` (whatever you've `ollama pull`ed) | no | private, on-device |

After picking provider + leader/worker models, the wizard:
1. Loads the sandbox's existing `~/.claude/settings.json` (preserves permissions, MCP servers, skills paths).
2. Clears stale provider env vars (`ANTHROPIC_*`).
3. Writes new ones (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`).
4. Backs up the previous file to `settings.json.bak`.

Next `claude` session in the sandbox picks up the new config automatically.

The main setup wizard (`setup-genesis.ps1`) offers to run this at the end. Or you can run it standalone any time.

## Using Claude Code + ClawTeam

Works identically in both WSL and VM backends. All commands below run **inside the sandbox** (`wsl -d Ubuntu` or `vagrant ssh`).

### Single Claude session

```bash
cd ~/projects/my-app
claude
```

Claude has access to:
- **7 skills** — docx, pdf, xlsx, pptx, frontend-design, advertisement, clawteam
- **5 MCPs** — fetch, git, playwright (3 Genesis-installed) + 2 Claude-defaults
- **4 agents** — planner, builder, reviewer, scribe (used by clawteam templates)
- **1 template** — `genesis-coder` (4-role parallel coding team)

### ClawTeam — agent swarms in tmux panes

**You drive it (CLI):**

```bash
cd ~/projects/my-app
clawteam template list                                    # see available teams

clawteam launch genesis-coder \
    --goal "Build a Python CLI that prints the first 10 primes, with pytest tests" \
    --workspace --repo .
```

This opens a **tmux session** with 4 Claude panes (planner leader + builder + reviewer + scribe) coordinating via ClawTeam's kanban board.

Attach/detach with tmux:
- Attach: `tmux attach -t clawteam`
- Detach: <kbd>Ctrl+b</kbd> then <kbd>d</kbd>
- See kanban: `clawteam board serve` (opens http://localhost:8080)

**Agent drives it (hands-free):**

```bash
claude
```

Then in Claude:

> "Use clawteam to spin up a `genesis-coder` team on this repo. Goal: build a Python CLI that prints the first 10 primes with pytest tests."

Claude reads `~/.claude/skills/clawteam/SKILL.md` and runs the CLI itself. Because `Bash(clawteam *)` + `Bash(tmux *)` are pre-allowed in `~/.claude/settings.json`, it proceeds without stalling on permission prompts.

### Built-in team templates

| Template | Source | Roles | Use case |
|---|---|---|---|
| `genesis-coder` | Genesis | planner, builder, reviewer, scribe | General-purpose coding |
| `code-review` | ClawTeam upstream | lead + reviewers | Review a PR / codebase |
| `hedge-fund` | ClawTeam upstream | varied | Financial research (demo) |
| `research-paper` | ClawTeam upstream | varied | Literature review |
| `strategy-room` | ClawTeam upstream | varied | Strategic analysis |

See all: `clawteam template list`.

### Writing your own template

Drop a `.toml` file into `~/.clawteam/templates/`. Mirror `~/.clawteam/templates/genesis-coder.toml` as a starting point.

---

## Wizard options

```powershell
.\setup\setup-genesis.ps1                         # WSL2 backend (default)
.\setup\setup-genesis.ps1 -VMFirst                # VM-first workflow
.\setup\setup-genesis.ps1 -Mode vm                # VM backend, basic (no ssh export)
.\setup\setup-genesis.ps1 -Distro Ubuntu-22.04    # pick a specific WSL distro
.\setup\setup-genesis.ps1 -SyncProjects C:\work   # (VM) mount Windows dir into VM
.\setup\setup-genesis.ps1 -SkipOpenClaw           # Claude Code + MCPs only
.\setup\setup-genesis.ps1 -Enable vibe-trading    # opt-in catalog items
.\setup\setup-genesis.ps1 -Disable playwright     # drop defaults
.\setup\setup-genesis.ps1 -AutoSignin             # auto-run `ollama signin`
```

## Where your projects live

| Backend | Path inside sandbox | Speed | Notes |
|---|---|---|---|
| **VM-first** | `/home/vagrant/projects/my-app` | native ext4 (fast) | VS Code via Remote-SSH |
| **WSL, ext4** | `/home/you/projects/my-app` | native ext4 (fast) | Windows access: `\\wsl$\Ubuntu\home\you\projects\...` |
| **WSL on NTFS** | `/mnt/c/Users/you/code/my-app` | ~10× slower small-file | Native Windows access |

For agent swarms, prefer the first two. `/mnt/c` is fine for light editing.

## Verification

Inside the sandbox:

```bash
claude --version
claude mcp list                             # should show 5 MCPs
ls ~/.claude/skills                         # 7 skills
ls ~/.claude/agents                         # 4 agents
ls ~/.clawteam/templates                    # 1 template (genesis-coder)

# Ollama reachability (VM uses 10.0.2.2, WSL uses host.docker.internal)
curl http://$(grep -oP 'OLLAMA_HOST[^"]+"\K[^"]+' ~/.claude/settings.json | head -1)/api/tags
```

On the Windows host:

```powershell
ollama whoami                                # confirm signed in
ollama run gpt-oss:120b-cloud "hi"           # smoke-test the cloud model
```

## Repo layout

```
genesis/
├─ setup/                   # PowerShell wizard
│  ├─ setup-genesis.ps1     # main wizard
│  ├─ bootstrap.ps1         # one-liner entry point
│  └─ lib/                  # common.ps1, wsl.ps1, mcp.ps1
├─ provision.sh             # shared Linux installer (WSL + VM)
├─ Vagrantfile              # VM config (Ubuntu 24.04)
├─ catalog/                 # skills.json, mcps.json, agents.json, templates.json
├─ skills/                  # Claude Code skills (bundled sources)
├─ agents/                  # planner, builder, reviewer, scribe prompts
├─ templates/               # ClawTeam team TOMLs (genesis-coder)
├─ mcp/                     # MCP registry + vendored sources
├─ scripts/                 # helpers (open-vm-in-vscode.ps1, validators)
├─ docs/                    # vm-snapshots, research, troubleshooting
├─ phase2/                  # planning notes for phase 2 development
└─ .github/workflows/       # CI
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bash: claude: command not found` inside WSL | `exec bash -l` to reload, or `source ~/.bashrc` |
| `ollama signin` opens a URL in the Linux terminal | Copy-paste it into your Windows browser — signin persists on the host |
| `claude mcp list` is empty | `claude upgrade` then re-run the wizard |
| VM `vagrant up` slow with Hyper-V enabled | VirtualBox uses paravirt mode — works but slower. To disable Hyper-V: `bcdedit /set hypervisorlaunchtype off` (admin + reboot) |
| VM `chmod: Read-only file system` | Fixed in `v0.2.4+`. `git pull` and `vagrant provision` again |
| Skills/agents summary shows `0` but Phase 8/10 logged installs | Fixed in `v0.2.4+`. `git pull` and `vagrant provision` again |
| `VBoxManage not recognized` after install | Close & reopen PowerShell — wizard's PATH self-healer runs on next invocation |
| `code` CLI missing for `open-vm-in-vscode.ps1` | In VS Code: <kbd>F1</kbd> → `Shell Command: Install 'code' command in PATH` |

More: [`docs/troubleshooting.md`](docs/troubleshooting.md).

## License

MIT — see [LICENSE](LICENSE).
