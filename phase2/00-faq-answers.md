# FAQ — answers to the questions that motivated phase 2

## 1. Are my install commands right?

**First install (one-liner, from any PowerShell, anywhere):**

```powershell
iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex
```

**Re-run / upgrade the wizard** (you do this *rarely*, only to pull new
teams/skills/MCPs from Genesis or recover a broken install):

```powershell
cd $env:USERPROFILE\genesis
git pull
.\setup\setup-genesis.ps1
```

**Enter WSL for daily work** (you do this *often*, every coding session):

```powershell
wsl -d Ubuntu
```

You had `wsl -d Ubuntu` labeled as "subsequent runs" — that's actually just
**entering the sandbox**. Not the same thing as re-running the wizard.

## 2. How do I launch ClawTeam after `wsl -d Ubuntu`?

Two supported paths. Both work. Pick per task.

### Path A — you drive it manually

```bash
cd ~/projects/my-repo
clawteam launch code-review --goal "Review for bugs and perf" --workspace --repo .
```

You type the command. You pick the template. You watch the tmux session.

### Path B — an agent drives ClawTeam via a skill

After we add the `clawteam` skill (see `02-custom-templates-plan.md`):

```bash
cd ~/projects/my-repo
claude
# At the Claude prompt: "Use clawteam to run a code-review team on primes.py."
```

Claude reads `~/.claude/skills/clawteam/SKILL.md`, learns the CLI, and runs
`clawteam launch …` itself. You never touch `clawteam` directly.

**Status:** Path A works today. Path B needs the `clawteam` skill installed
— plan in `02-custom-templates-plan.md`.

## 3. Is the Windows Claude Code the same as the WSL one?

**No — they're two separate installs with independent state:**

|                      | Windows Claude                  | WSL Claude (Genesis)              |
|----------------------|---------------------------------|-----------------------------------|
| Binary               | `C:\Users\you\AppData\Roaming\npm\claude`  | `/usr/local/bin/claude` (WSL)     |
| Config dir           | `C:\Users\you\.claude\`         | `/home/you/.claude/`              |
| MCPs                 | whatever you configured there   | 5 user-scope entries from Genesis |
| Skills               | whatever you installed          | 6 bundled (no `clawteam` yet)     |
| Talks to ClawTeam?   | Not directly (ClawTeam is in WSL) | Yes — same filesystem            |

**Use the WSL one.** The Windows one is a leftover from your earlier manual
install attempts. It's harmless but nothing in Genesis uses it.

## 4. Is the `idea.md` understanding of "lead agent" correct?

**Yes.** The lead agent is **whoever's reading your prompt and invoking
`clawteam`**:

- You prompt **OpenClaw daemon** (via Telegram/Discord) → OpenClaw is lead.
- You prompt **Claude Code** (`claude` in WSL) → Claude Code is lead.
- You type `clawteam launch …` yourself → **you** are lead (no AI lead at
  all; ClawTeam just orchestrates the workers).

The workers spawned inside the team are separate — they can be `claude`,
`openclaw`, `codex`, or any CLI agent ClawTeam supports. The lead doesn't
have to match the workers.

## 5. Does WSL have access to my Windows disk?

**Yes, at the filesystem level** — Windows drives auto-mount under `/mnt/`:

```bash
# Inside WSL:
ls /mnt/c/Users/netfl/                  # your Windows home
cd /mnt/c/Users/netfl/SKYNET/my-project
code .                                  # opens VS Code via WSL extension
```

**Performance caveat.** `/mnt/c` I/O is ~10× slower than native WSL (ext4)
because every read/write crosses the Windows↔Linux boundary. For agent work
(which writes lots of small files), **clone to `~/projects/` inside WSL**:

```bash
mkdir -p ~/projects
cd ~/projects
git clone git@github.com:you/my-project.git
```

You can still `git push` to GitHub — remote access is unaffected.

**Isolation caveat.** WSL2 is a VM but shares your Windows user's files. If a
rogue script inside WSL runs `rm -rf /mnt/c/Users/netfl`, it *can* nuke your
Windows files. If that bothers you, use `-Mode vm` (Vagrant + VirtualBox)
for stronger isolation — the VM only sees its own disk.

## 6. Can I add custom team templates? And is Vibe-Trading different from ClawTeam's `hedge-fund`?

**Yes to both.**

**Custom templates:** Drop a `.toml` file into `~/.clawteam/templates/`. The
next `clawteam template list` picks it up. The format is a small TOML schema
defining the team name, roles, per-agent tasks, and the shared command to
spawn each agent (usually `claude` or `openclaw`).

**Vibe-Trading vs `hedge-fund`:**

| | ClawTeam `hedge-fund` (builtin) | Vibe-Trading (separate repo) |
|---|---|---|
| Format | 1 TOML file | 29 YAML swarm presets |
| Scope | ~4 generic roles | 7 finance domains (investment_committee, global_equities_desk, quant_strategy_desk, etc.) |
| Tools | none custom | 21 finance tools (backtest, factor analysis, options pricing) |
| MCP | — | Ships its own `vibe-trading-mcp` with 17 tools |

They're **not** the same. Two integration options — see
`02-custom-templates-plan.md` for the recommendation.

## 7. Can we add the existing `agents/` folder as a ClawTeam template?

**Yes, and we should.** Today those 4 prompt files (`planner`, `builder`,
`reviewer`, `scribe`) get copied into `~/.claude/agents/` where Claude Code
picks them up as **subagents** for single-Claude-session use.

We can *also* author `templates/genesis-coder.toml` — a ClawTeam template
that spawns 4 Claude instances in parallel panes, one per role, sharing a
git worktree. Same prompts, two execution models:

- **Claude Code subagents**: sequential, one pane, one Claude.
- **ClawTeam team**: parallel, N panes, N Claudes, messaging.

Details in `02-custom-templates-plan.md`.
