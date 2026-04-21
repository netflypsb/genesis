# Custom templates & skills — technical plan

## Goals for phase 2

1. Install the `clawteam` **skill** into Claude Code and (optionally)
   OpenClaw so agents can self-orchestrate.
2. Ship a first-party `genesis-coder` **ClawTeam template** that reuses our
   existing `agents/planner|builder|reviewer|scribe` prompts.
3. Integrate **Vibe-Trading** — recommend the MCP path over toml translation.
4. Make all of the above **pluggable via `mcp/registry.json`-style catalogs**
   so users can selectively install teams/skills/MCPs.

## 1. Add the `clawteam` skill to our skill bundle

### Where it comes from

The `clawteam` skill is a `SKILL.md` file that teaches a host agent how to
drive the `clawteam` CLI. Upstream location:

```
win4r/ClawTeam-OpenClaw/skills/openclaw/SKILL.md
```

The name is misleading — the file is for *any* agent (Claude, OpenClaw,
Codex). Upstream just happened to put it under `skills/openclaw/`.

### Where it goes

- For Claude Code: `~/.claude/skills/clawteam/SKILL.md`
- For OpenClaw: `~/.openclaw/workspace/skills/clawteam/SKILL.md`

### What changes in Genesis

**`provision.sh` — add a step between phases 8 and 9:**

```bash
# Phase 8b — clawteam skill for Claude (and OpenClaw if daemon installed)
if [[ "$GENESIS_SKIP_CLAWTEAM_SKILL" != "1" ]]; then
  log "Phase 8b — installing clawteam skill"
  CT_SRC="$HOME/ClawTeam-OpenClaw/skills/openclaw/SKILL.md"
  mkdir -p "$HOME/.claude/skills/clawteam"
  cp -f "$CT_SRC" "$HOME/.claude/skills/clawteam/SKILL.md"
  step "installed clawteam skill → ~/.claude/skills/clawteam/SKILL.md"

  if [[ -d "$HOME/.openclaw/workspace/skills" ]]; then
    mkdir -p "$HOME/.openclaw/workspace/skills/clawteam"
    cp -f "$CT_SRC" "$HOME/.openclaw/workspace/skills/clawteam/SKILL.md"
    step "installed clawteam skill → ~/.openclaw/workspace/skills/clawteam/SKILL.md"
  fi
fi
```

Add a matching `-SkipClawteamSkill` flag in `setup-genesis.ps1`.

### Auto-approval for agent-driven clawteam calls

Without this, Claude pauses at every `clawteam` invocation for user
permission. Update `~/.claude/settings.json` Phase 9 writer to extend the
permissions allowlist:

```json
"permissions": {
  "allow": [
    "Read",
    "Bash(clawteam *)",
    "Bash(tmux *)",
    "Bash(git status)",
    "Bash(git diff *)",
    "Bash(ls *)"
  ]
}
```

Same principle for OpenClaw: its `~/.openclaw/workspace/exec-approvals.json`
needs `clawteam` in the allowlist (the upstream install-openclaw.sh already
does this; we just need to not overwrite it).

## 2. `genesis-coder` ClawTeam template

### Design

Reuse the 4 prompts in `agents/*.md` but wrap them as a multi-agent team.
ClawTeam templates are TOML with this shape (from upstream `strategy-room.toml`):

```toml
# templates/genesis-coder.toml

name = "genesis-coder"
description = "4-role coding team: planner -> builder <-> reviewer -> scribe"
command = "claude"              # each agent runs `claude` in its pane
backend = "tmux"
workspace = true                # isolate each agent in a git worktree

[leader]
name = "planner"
system_prompt_file = "agents/planner.md"
task = "Read the project goal. Produce a step-by-step plan as numbered tasks with acceptance criteria. Hand off to builder via clawteam inbox."

[[agents]]
name = "builder"
system_prompt_file = "agents/builder.md"
task = "Pick up tasks from planner's inbox. Implement. Write tests. Commit. Request review from reviewer."

[[agents]]
name = "reviewer"
system_prompt_file = "agents/reviewer.md"
task = "Review builder's commits. Block on failing tests or style violations. Approve with a checklist."

[[agents]]
name = "scribe"
system_prompt_file = "agents/scribe.md"
task = "Maintain a running CHANGELOG.md + commit message summaries. Fire once builder has a reviewer-approved commit."
```

### Where it ships in the repo

```
genesis/
├─ agents/                         (existing — Claude subagent prompts)
│   ├─ planner.md  builder.md
│   └─ reviewer.md scribe.md
└─ templates/                      (NEW)
    └─ genesis-coder.toml
```

### Install path

`provision.sh` Phase 10 already copies `agents/*.md` to `~/.claude/agents/`.
Extend it:

```bash
log "Phase 10 — agent prompts + clawteam templates"

# Existing: per-project subagents for Claude
mkdir -p "$HOME/.claude/agents"
cp -f "$GENESIS_HOME"/agents/*.md "$HOME/.claude/agents/" 2>/dev/null || true

# NEW: clawteam team templates
mkdir -p "$HOME/.clawteam/templates"
for tmpl in "$GENESIS_HOME"/templates/*.toml; do
  [[ -f "$tmpl" ]] || continue
  cp -f "$tmpl" "$HOME/.clawteam/templates/"
  step "template: $(basename "$tmpl")"
done
```

### First-use demo

```bash
mkdir -p ~/projects/demo && cd ~/projects/demo
git init -q && git commit --allow-empty -q -m "init"

clawteam launch genesis-coder \
  --goal "Build a FastAPI /todos CRUD with SQLite + pytest" \
  --workspace --repo .
```

## 3. Vibe-Trading integration — recommendation: MCP path

### Why MCP over translating YAML→TOML

Vibe-Trading isn't just 29 agent role bundles — it's **29 role bundles +
21 specialized tools + 69 finance skills + a ReAct runtime**. Translating
just the YAML swarm presets to ClawTeam TOML throws away the tools and
skills; you'd end up with agents that can't actually do the finance work.

**Better path:** install `vibe-trading-mcp` as a user-scope MCP server.
Then **any** ClawTeam agent (including our `genesis-coder`) can call its
finance tools via standard MCP protocol.

### Plan

1. Add Vibe-Trading's MCP server to `mcp/registry.json`:

   ```json
   {
     "name": "vibe-trading",
     "scope": "user",
     "optional": true,
     "transport": "stdio",
     "command": "uvx",
     "args": ["vibe-trading-mcp"],
     "description": "17 finance tools: backtest, factor analysis, options pricing, web search, pattern detection"
   }
   ```

2. Provision.sh Phase 7 already does `claude mcp add --scope user` for each
   entry; `vibe-trading` will be registered automatically (gated by a
   `-SkipVibeTrading` wizard flag for users who don't want it).

3. **Optional:** author a `templates/finance-desk.toml` that seeds a small
   3-agent team (analyst/strategist/risk) pre-wired to use `vibe-trading`'s
   tools. This is the 80/20 — a taste of Vibe-Trading without porting all 29
   presets.

### If the user really wants the full 29 presets later

Open a phase 3 task: write a YAML→TOML transpiler that walks
`HKUDS/Vibe-Trading/agent/config/swarm/*.yaml` and emits one TOML per
preset. Straightforward — each YAML has `agents: [{name, role}]` and
`tasks: [{agent, prompt}]` which map 1:1 to ClawTeam's TOML schema.

## 4. Pluggable catalogs — repo structure

See [`04-repo-reorg.md`](04-repo-reorg.md). TL;DR: add `templates/` as a
top-level dir alongside `mcp/`, `skills/`, `agents/`, each with a
`registry.json` manifest the wizard reads.

## Acceptance criteria for this work item

- [ ] `~/.claude/skills/clawteam/SKILL.md` exists after `provision.sh`.
- [ ] `clawteam template list` shows `genesis-coder` after provision.
- [ ] `claude` session with prompt "Use clawteam to run a code-review team
      on README.md" successfully spawns a tmux session (no permission
      prompt blocking).
- [ ] `claude mcp list` includes `vibe-trading` when not skipped.
- [ ] All of the above idempotent on re-run.
