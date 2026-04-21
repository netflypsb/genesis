# Architecture — three layers, one filesystem

```
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: Lead agent (reads your prompt, drives everything below)        │
│  ────────────────────────────────────────────────────────────────────    │
│   Option A: you (manual)         Option B: claude        Option C: openclaw│
│   typing CLI commands            (interactive session)    (24/7 daemon)   │
│                                  ^-- needs clawteam       ^-- needs clawteam│
│                                      skill                   skill         │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ invokes `clawteam launch <template>`
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: ClawTeam — orchestrator (tmux + JSON state in ~/.clawteam)     │
│  ────────────────────────────────────────────────────────────────────    │
│   templates/   → defines roles & prompts       inbox/   → messages       │
│   teams/       → running team state            tasks/   → kanban         │
│   workspaces/  → git worktrees per agent       cost/    → token spend    │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼ spawns N worker agents (tmux panes)
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Worker agents — where actual LLM calls happen                  │
│  ────────────────────────────────────────────────────────────────────    │
│   claude (most common)   openclaw   codex   nanobot   kimi   cursor      │
│                                                                          │
│   Each worker:                                                           │
│   • runs in its own tmux pane + git worktree                             │
│   • has a role-specific system prompt from the template                  │
│   • sees user-scope MCPs (fetch, git, playwright, ...)                   │
│   • sees user-scope skills (docx, pdf, clawteam, ...)                    │
│   • sends/receives messages via `clawteam inbox`                         │
└──────────────────────────────────────────────────────────────────────────┘
```

## The "lead agent" rule

**Lead = whoever invokes `clawteam`.**

|Scenario|Lead|Workers|
|---|---|---|
|`clawteam launch code-review` typed by you|you (no AI)|N × `claude`|
|`claude` session, you say "use clawteam…"|`claude`|N × `claude`|
|Telegram message to OpenClaw daemon|`openclaw`|N × `claude` or N × `openclaw`|
|Nested swarm (worker spawns its own team)|the worker|grandchildren|

The lead doesn't have to be the same model/CLI as the workers. A single
OpenClaw daemon can spawn clawteams of Claude Code instances.

## Skills are per-CLI, per-user

|CLI|Skill dir|
|---|---|
|Claude Code|`~/.claude/skills/`|
|OpenClaw|`~/.openclaw/workspace/skills/`|
|Codex|`$CODEX_HOME/skills/` (default `~/.codex/skills/`)|

The `clawteam` skill is a `SKILL.md` file that teaches the host CLI how to
use the `clawteam` binary. **It must be installed into whichever CLI you
want to act as lead.** Installing it into Claude lets `claude` spawn teams.
Installing it into OpenClaw lets the daemon spawn teams. They're
independent.

## MCPs are user-scope (global across projects)

Registered once via `claude mcp add --scope user`. Every `claude` session in
that WSL user sees the same MCP catalog: `fetch`, `git`, `playwright`, plus
any we add in phase 2 (e.g., `vibe-trading-mcp`, `github`, `postgres`).

Workers spawned by ClawTeam inherit user-scope MCPs automatically — no
per-team MCP plumbing needed.

## Filesystem layout (what lives where inside WSL)

```
~/                                         Your Linux home
├─ .claude/                                Claude Code state
│   ├─ settings.json                       ANTHROPIC_BASE_URL=http://localhost:11434
│   ├─ .claude.json                        (MCP user-scope registry)
│   ├─ agents/                             Claude subagent prompts
│   │   ├─ planner.md   builder.md         (from Genesis)
│   │   └─ reviewer.md  scribe.md
│   └─ skills/                             Claude skills (SKILL.md each)
│       ├─ docx/   pdf/   xlsx/   pptx/    (Genesis-bundled)
│       ├─ frontend-design/  advertisement/
│       └─ clawteam/   ← PHASE 2 ADDS THIS
│
├─ .clawteam/                              ClawTeam state
│   ├─ teams/           inbox/  tasks/
│   ├─ workspaces/      cost/   sessions/
│   └─ templates/                          user-added team TOMLs
│       ├─ genesis-coder.toml              ← PHASE 2 ADDS THIS
│       └─ vibe-trading-*.toml             ← PHASE 2 ADDS THIS (maybe)
│
├─ .openclaw/                              OpenClaw state (only if daemon used)
│   └─ workspace/
│       ├─ config.yaml                     channels, pairing
│       ├─ skills/clawteam/SKILL.md        ← PHASE 2 ADDS THIS
│       └─ exec-approvals.json             allowlist clawteam binary
│
├─ ClawTeam-OpenClaw/                      cloned repo, installed with pipx
├─ genesis/                                cloned Genesis repo (for reference)
└─ projects/                               ← put your actual code here
    ├─ my-saas-app/
    └─ my-trading-bot/
```

## Host-guest boundary

```
Windows host                         WSL Ubuntu (same user, mirrored net)
──────────────                       ─────────────────────────────────────
Ollama desktop app                   claude --> localhost:11434 --> host Ollama
on 0.0.0.0:11434                     clawteam spawns `claude` workers
                                     openclaw daemon (optional)
C:\Users\netfl\...       ⇄ /mnt/c/Users/netfl/...  (slow, shared r/w)
                                     ~/projects/...  (fast, Linux-only)
```

**Ollama never runs inside WSL.** Genesis configures `ANTHROPIC_BASE_URL` to
reach the Windows-side Ollama daemon over the mirrored loopback (`localhost`)
or NAT (`host.docker.internal`) — whichever works.
