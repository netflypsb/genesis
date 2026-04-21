---
name: clawteam
description: "Multi-agent swarm coordination via the ClawTeam CLI. Use when the user wants to create agent teams, spawn multiple agents to work in parallel, coordinate tasks with dependencies, broadcast messages between agents, monitor progress via kanban board, or launch pre-built team templates (hedge-fund, code-review, research-paper, genesis-coder). ClawTeam uses git worktree isolation + tmux + filesystem-based messaging. Trigger phrases: team, swarm, multi-agent, clawteam, spawn agents, parallel agents, agent team."
---

# ClawTeam — Multi-Agent Swarm Coordination

> Vendored from `win4r/ClawTeam-OpenClaw` `skills/openclaw/SKILL.md`.
> Genesis installs this to `~/.claude/skills/clawteam/SKILL.md` so Claude
> Code (the lead agent) can drive ClawTeam without manual CLI wrangling.

## Overview

ClawTeam is a CLI tool (`clawteam`) for orchestrating multiple AI agents as self-organizing swarms. It uses git worktree isolation, tmux windows, and filesystem-based messaging. **OpenClaw is the default worker backend** — do not override workers to `claude`.

**CLI binary**: `clawteam` (installed via pipx, on PATH)

## Quick Start

### One-Command Template Launch (Recommended)

```bash
# Launch a pre-built team from a template
clawteam launch genesis-coder --goal "Build a FastAPI todo service" --workspace --repo .
clawteam launch hedge-fund --team fund1
clawteam launch code-review --team review1
clawteam launch research-paper --team paper1
```

### Manual Team Setup

```bash
# 1. Create team with leader
clawteam team spawn-team my-team -d "Build a web app" -n leader

# 2. Create tasks with dependencies
clawteam task create my-team "Design API schema" -o architect
# Returns task ID, e.g., abc123

clawteam task create my-team "Implement auth" -o backend --blocked-by abc123
clawteam task create my-team "Build frontend" -o frontend --blocked-by abc123
clawteam task create my-team "Write tests" -o tester

# 3. Spawn agents (each gets its own tmux window + git worktree)
clawteam spawn -t my-team -n architect --task "Design the API schema for a web app"
clawteam spawn -t my-team -n backend --task "Implement OAuth2 authentication"
clawteam spawn -t my-team -n frontend --task "Build React dashboard"

# 4. Monitor
clawteam board show my-team        # Kanban view
clawteam board attach my-team      # Tmux tiled view (all agents side-by-side)
clawteam board serve --port 8080   # Web dashboard
```

## Command Reference

### Team Management

| Command | Description |
|---|---|
| `clawteam team spawn-team <name> -d "<desc>" -n <leader>` | Create team |
| `clawteam team discover` | List all teams |
| `clawteam team status <team>` | Show team members and info |
| `clawteam team cleanup <team> --force` | Delete team and all data |

### Task Management

| Command | Description |
|---|---|
| `clawteam task create <team> "<subject>" -o <owner> [-d "<desc>"] [--blocked-by <id>]` | Create task |
| `clawteam task list <team> [--owner <name>]` | List tasks (filterable) |
| `clawteam task update <team> <id> --status <status>` | Update status |
| `clawteam task get <team> <id>` | Get single task |
| `clawteam task stats <team>` | Timing statistics |
| `clawteam task wait <team>` | Block until all tasks complete |

**Task statuses**: `pending`, `in_progress`, `completed`, `blocked`.
**Dependency auto-resolution**: when a blocking task completes, dependents auto-unblock.
**Task locking**: when a task moves to `in_progress`, it's locked by the claiming agent. Stale locks from dead agents are auto-released.

### Agent Spawning

**IMPORTANT**: Always use the default command (`openclaw`) — do NOT override to `claude`. The default handles permissions, prompt injection, and nesting detection correctly. If you specify `claude` as the worker command, agents get stuck on interactive permission prompts.

```bash
# Default (RECOMMENDED): spawns openclaw tui in tmux with prompt
clawteam spawn -t <team> -n <name> --task "<task description>"

# With git worktree isolation (recommended for coding teams)
clawteam spawn -t <team> -n <name> --task "<task>" --workspace --repo /path/to/repo
```

Each spawned agent gets:

- Its own tmux window (visible via `board attach`)
- Its own git worktree branch (`clawteam/{team}/{agent}`)
- An auto-injected coordination prompt (how to use clawteam CLI)
- Environment: `CLAWTEAM_AGENT_NAME`, `CLAWTEAM_TEAM_NAME`, etc.

### Messaging

| Command | Description |
|---|---|
| `clawteam inbox send <team> <to> "<msg>" --from <sender>` | Point-to-point |
| `clawteam inbox broadcast <team> "<msg>" --from <sender>` | Broadcast |
| `clawteam inbox peek <team> -a <agent>` | Peek without consuming |
| `clawteam inbox receive <team>` | Consume messages |
| `clawteam inbox log <team>` | View message history |

### Monitoring

| Command | Description |
|---|---|
| `clawteam board show <team>` | Kanban board (rich terminal) |
| `clawteam board overview` | All teams overview |
| `clawteam board live <team>` | Live-refreshing board |
| `clawteam board attach <team>` | Tmux tiled view |
| `clawteam board serve --port 8080` | Web dashboard |

### Cost Tracking

| Command | Description |
|---|---|
| `clawteam cost report <team> --input-tokens <N> --output-tokens <N> --cost-cents <N>` | Report usage |
| `clawteam cost show <team>` | Summary |
| `clawteam cost budget <team> <dollars>` | Set budget |

### Templates

| Command | Description |
|---|---|
| `clawteam template list` | List available templates |
| `clawteam template show <name>` | Show template details |
| `clawteam launch <template> [--team-name <name>] [--goal "<goal>"] [--workspace] [--repo <path>]` | Launch from template |

**Built-in templates**: `hedge-fund`, `code-review`, `research-paper`, `strategy-room`.
**Genesis-added templates**: `genesis-coder` (4-role coding team).

### Configuration

```bash
clawteam config show                           # Show all settings
clawteam config set user <your-name>           # Set your identity
clawteam config set transport file             # Transport backend
clawteam config set skip_permissions true      # Auto-skip permission prompts
clawteam config health                         # System health check
```

## JSON Output

Add `--json` before any subcommand for machine-readable output:

```bash
clawteam --json task list my-team
clawteam --json team status my-team
```

## Typical Workflow

1. **User says**: "Create a team to build a web app"
2. **You do**: `clawteam team spawn-team webapp -d "Build web app" -n leader`
3. **Create tasks**: `clawteam task create` with `--blocked-by` for dependencies
4. **Spawn agents**: `clawteam spawn` for each worker
5. **Monitor**: Start a background polling loop immediately — do NOT wait for the user to ask
6. **Communicate**: `clawteam inbox broadcast` for team-wide updates
7. **Deliver**: Proactively send final results to the user as soon as all tasks complete
8. **Cleanup**: `clawteam cost show`, `clawteam task stats`, merge worktrees, then `clawteam team cleanup webapp --force`

## Leader Orchestration Pattern

### Phase 1: Analyze & Plan

1. Understand the user's goal.
2. Break it into independent subtasks.
3. Identify dependencies.
4. Decide worker count.

### Phase 2: Setup

```bash
clawteam team spawn-team <team> -d "<goal>" -n leader
clawteam task create <team> "Design API" -o architect
clawteam task create <team> "Build backend" -o backend --blocked-by <id>
clawteam task create <team> "Build frontend" -o frontend --blocked-by <id>
clawteam task create <team> "Integration tests" -o tester --blocked-by <backend-id>,<frontend-id>
```

### Phase 3: Spawn Workers

```bash
clawteam spawn -t <team> -n architect --task "Design REST API schema for <goal>"
clawteam spawn -t <team> -n backend --task "Implement backend based on API schema"
clawteam spawn -t <team> -n frontend --task "Build React frontend"
clawteam spawn -t <team> -n tester --task "Write and run integration tests"
```

### Phase 4: Monitor Loop

**Start monitoring immediately after spawning.** Don't wait for the user. Push mid-progress updates proactively (e.g. "4/7 done, 3 working").

```bash
while true; do
  clawteam --json task list <team> | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
done  = sum(1 for t in tasks if t['status'] == 'completed')
total = len(tasks)
print(f'{done}/{total} complete')
if done == total:
    print('ALL DONE'); sys.exit(0)
"
  clawteam inbox receive <team>
  sleep 30
done
```

### Phase 5: Converge & Report

Deliver results the moment all tasks are `completed` — don't wait to be asked.

```bash
clawteam board show <team>
clawteam cost show <team>
clawteam task stats <team>
for agent in <agent1> <agent2> ...; do
  clawteam workspace merge <team> --agent $agent
done
clawteam team cleanup <team> --force
```

### Decision Rules for the Leader

- **Independent tasks** → spawn workers in parallel.
- **Sequential tasks** → chain with `--blocked-by`; ClawTeam auto-unblocks.
- **Worker asks for help** → check inbox, reply via `inbox send`.
- **Worker stuck** → if `in_progress` too long, nudge via `inbox send`.
- **Worker done** → verify via inbox, advance phase.
- **All done** → merge worktrees, deliver to user proactively, then cleanup.
- **Always** → start background monitoring immediately after spawn.

## Data Location

All state in `~/.clawteam/`:

- Teams: `~/.clawteam/teams/<team>/config.json`
- Tasks: `~/.clawteam/tasks/<team>/task-<id>.json`
- Plans: `~/.clawteam/plans/<team>/<agent>-<plan_id>.md`
- Messages: `~/.clawteam/teams/<team>/inboxes/<agent>/msg-*.json`
- Costs: `~/.clawteam/costs/<team>/`
- User templates: `~/.clawteam/templates/*.toml`
