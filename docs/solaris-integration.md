# Integrating Solaris (Electron + Claude Agent SDK) with Genesis + ClawTeam

**Audience:** Solaris engineers building a Windows desktop app on top of the
Anthropic Claude Agent SDK who want to give their agent the ability to
spawn **multi-agent Claude Code teams** via ClawTeam, with the whole
environment bootstrapped by the Genesis installer.

**What you'll be able to do at the end:** From inside your Electron app,
have the Solaris agent say "spin up a 4-agent team to build X, come back
when done" — and have Genesis + ClawTeam + Claude Code handle the rest
inside a WSL2 or Vagrant sandbox on the user's Windows machine.

---

## 1. The mental model

```
┌─────────────────────────────────────────────────────────────────────┐
│  Windows host                                                       │
│                                                                     │
│  ┌─────────────────────────┐        ┌──────────────────────────┐   │
│  │  Solaris (Electron)     │  shell │  WSL2 Ubuntu / Vagrant   │   │
│  │  - renderer (React/UI)  │ ─────→ │  VM (Genesis sandbox)    │   │
│  │  - main process (Node)  │  out   │                          │   │
│  │  - Claude Agent SDK     │        │  - claude (Code CLI)     │   │
│  │    (@anthropic-ai/sdk)  │        │  - clawteam (team CLI)   │   │
│  │                         │        │  - openclaw (daemon)     │   │
│  │                         │  HTTP  │  - ~/.claude/skills/*    │   │
│  │                         │ ─────→ │  - ~/.claude/agents/*    │   │
│  │                         │ :18789 │  - ~/.clawteam/templates/│   │
│  └─────────────────────────┘        └──────────────────────────┘   │
│                                                                     │
│  Genesis = the scripts that build the right side.                   │
└─────────────────────────────────────────────────────────────────────┘
```

Three distinct things:

| Layer | What it is | Runs as |
|---|---|---|
| **Solaris** | Your Electron app | Windows process |
| **Genesis** | Installer scripts (PowerShell + bash) | Run once, produces the sandbox |
| **Sandbox** | WSL Ubuntu or a Vagrant VM | Linux, hosts `claude`/`clawteam`/`openclaw` |

Solaris **never installs Claude Code, ClawTeam, or OpenClaw directly on
Windows**. That happens inside WSL/VM. Solaris **talks to them** across
the boundary via one of the three bridges described below.

---

## 2. Why this composition makes sense

- **Claude Agent SDK in Solaris** = conversational UX, streaming in the
  Electron UI, tool use driven by your own app logic.
- **Claude Code inside the sandbox** = full file-editing, Bash-executing,
  multi-file-context coding agent that lives close to the files.
- **ClawTeam** = spawns *multiple* Claude Code processes in a team
  topology (planner/builder/reviewer/scribe) over tmux.
- **Genesis** = one-shot installer so your users don't have to
  `apt install`, `uv tool install`, `pipx install`, `claude mcp add`
  fifteen times.

Your Solaris agent's job stays small: understand the user intent, hand
off large coding tasks to a spawned team, display progress, report back.
The team does the heavy lifting with full repo context.

---

## 3. Three integration patterns

### Pattern A — Shell-out (simplest, start here)

Your Electron main process spawns `wsl.exe` (or `vagrant ssh`) and runs
`clawteam launch ...`. You parse stdout/stderr and the ClawTeam board
JSON for progress.

**Pros:** zero new infrastructure, works the day Genesis is installed.
**Cons:** fragile to output format changes; no streaming unless you tail.

### Pattern B — OpenClaw Gateway HTTP (cleanest, needs `-OpenClawDaemon`)

User opts into Genesis's OpenClaw daemon. It exposes an HTTP API on
`127.0.0.1:18789` (forwarded from WSL/VM to Windows via Genesis's
Vagrantfile). Solaris POSTs to it.

**Pros:** stable API, streaming status via WebSocket or SSE, survives
Solaris restarts, can be DM'd from outside Solaris too.
**Cons:** requires the daemon to be installed and running; today
(April 2026) there is a known onboard probe issue under VirtualBox NAT —
works reliably under WSL, flakier under VM.

### Pattern C — Claude Agent SDK + `clawteam` skill (agent-driven)

Load Genesis's `skills/clawteam/SKILL.md` into the Solaris agent session.
Give the SDK's bash tool permission to run `wsl -d Ubuntu -- clawteam ...`.
Let the Solaris agent *decide* when to spawn a team.

**Pros:** highest-agency UX — Solaris agent autonomously orchestrates
teams. No custom orchestration code.
**Cons:** need to sandbox bash tool carefully; agent errors are harder
to debug.

**Recommended starting point: Pattern A, migrate to Pattern B once the
daemon is stable on your users' setups, optionally combine with C for
agent-driven escalation.**

---

## 4. Prerequisites you'll bundle or detect

### 4.1 On first launch, Solaris should check

```typescript
// main/genesis-detect.ts
import { execFileSync } from 'child_process';
import fs from 'fs';

interface GenesisState {
  wslAvailable: boolean;
  wslDistro?: string;
  genesisInstalled: boolean;
  claudeCodeReady: boolean;
  clawteamReady: boolean;
  openclawDaemon: 'active' | 'installed' | 'absent';
}

export async function detectGenesis(): Promise<GenesisState> {
  const state: GenesisState = {
    wslAvailable: false,
    genesisInstalled: false,
    claudeCodeReady: false,
    clawteamReady: false,
    openclawDaemon: 'absent',
  };

  // WSL present?
  try {
    execFileSync('wsl.exe', ['--status'], { stdio: 'pipe' });
    state.wslAvailable = true;
  } catch {
    return state; // WSL missing -> offer to install
  }

  // Genesis markers inside WSL
  const markers = wslExec(['test', '-f', '/home/$USER/.claude/settings.json']);
  if (markers.status === 0) state.genesisInstalled = true;

  // Binary smoke tests
  state.claudeCodeReady = wslExec(['which', 'claude']).status === 0;
  state.clawteamReady  = wslExec(['which', 'clawteam']).status === 0;

  // Daemon
  const svc = wslExec(['systemctl', '--user', 'is-active', 'openclaw-gateway']);
  state.openclawDaemon = svc.stdout.trim() === 'active' ? 'active'
    : svc.status === 0 ? 'installed' : 'absent';

  return state;
}

function wslExec(cmd: string[]) {
  try {
    const out = execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', ...cmd],
      { stdio: 'pipe', encoding: 'utf8' });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e: any) {
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
```

### 4.2 If Genesis is not installed, offer to bootstrap

Provide a button in Solaris's setup wizard that runs the Genesis one-liner
in a hidden PowerShell:

```typescript
// main/genesis-install.ts
import { spawn } from 'child_process';

export function runGenesisBootstrap(onLog: (line: string) => void) {
  const ps = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    'iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex',
  ], { windowsHide: false }); // show window — user may need to answer prompts

  ps.stdout.on('data', (b) => onLog(b.toString()));
  ps.stderr.on('data', (b) => onLog(b.toString()));
  return new Promise<number>((resolve) => ps.on('exit', (c) => resolve(c ?? 1)));
}
```

**You cannot fully hide the window** because Genesis's wizard asks
interactive questions (RAM confirmations, ollama signin prompts). Either:

- Show the PowerShell window and tell the user to follow prompts, **or**
- Pre-flag everything via env vars before launch:

```typescript
// Non-interactive install (VM-first, no OpenClaw daemon, no RAM confirm).
// Users still do `ollama signin` manually; wizard will skip if env said so.
const env = {
  ...process.env,
  GENESIS_SKIP_OLLAMA_SIGNIN: '1',
  GENESIS_SKIP_OPENCLAW: '0',
  GENESIS_VM_MEMORY: '6144',  // 6 GB if user has 16 GB host
};
spawn('powershell.exe', [...], { env, windowsHide: true });
```

Check `@provision.sh` top of file for the full env-knob list.

### 4.3 If user picks WSL (recommended for Solaris embedding)

Genesis installs everything into WSL Ubuntu. Solaris spawns `wsl.exe` as
a subprocess. No port forwards needed for Pattern A; `http://localhost:18789`
works natively for Pattern B because WSL2 shares the Windows loopback.

### 4.4 If user picks VM-first

Genesis installs into a Vagrant VirtualBox VM. Solaris spawns
`vagrant ssh ...` (or connects directly via the SSH config Genesis writes
to `~/.ssh/config.d/genesis`). The `Vagrantfile` forwards ports 18789
(OpenClaw), 8080 (ClawTeam board), 11435 (guest Ollama) to Windows.

For Solaris purposes **WSL is easier**. Offer VM only to power users.

---

## 5. Pattern A — Shell-out to `clawteam`

### 5.1 Launch a team

```typescript
// main/team-launch.ts
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

export interface TeamLaunchOpts {
  template: 'genesis-coder' | 'finance-desk' | 'deep-research'
           | 'code-review' | 'hedge-fund' | 'research-paper' | 'strategy-room';
  goal: string;
  repoPath?: string;              // Windows path like C:\Users\you\code\myapp
  workspace?: boolean;            // detach into a clawteam workspace (recommended)
}

export function launchTeam(opts: TeamLaunchOpts, onLog: (l: string) => void) {
  const repoWsl = opts.repoPath ? winToWsl(opts.repoPath) : '/home/$USER/projects/solaris-run';
  const args = [
    '-d', 'Ubuntu', '--',
    'bash', '-lc',
    // Single-quoted bash string to preserve inner quotes
    `clawteam launch ${opts.template} --goal ${shellQuote(opts.goal)} --repo ${shellQuote(repoWsl)}${opts.workspace ? ' --workspace' : ''}`,
  ];
  const ct = spawn('wsl.exe', args, { stdio: 'pipe' });
  ct.stdout.on('data', (b) => onLog(b.toString()));
  ct.stderr.on('data', (b) => onLog(b.toString()));
  return new Promise<{ teamId: string | null; exitCode: number }>((resolve) => {
    let teamId: string | null = null;
    ct.stdout.on('data', (b) => {
      const m = b.toString().match(/team[-_]?id[:\s=]+([a-z0-9-]+)/i);
      if (m) teamId = m[1];
    });
    ct.on('exit', (c) => resolve({ teamId, exitCode: c ?? 1 }));
  });
}

function winToWsl(win: string): string {
  // C:\Users\foo -> /mnt/c/Users/foo
  const drive = win[0].toLowerCase();
  return `/mnt/${drive}/` + win.slice(3).replace(/\\/g, '/');
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
```

### 5.2 Poll team progress

ClawTeam writes a machine-readable board under `~/.clawteam/state/<team-id>/board.json`.
Tail it via WSL:

```typescript
// main/team-status.ts
import { execFileSync } from 'child_process';

export function readTeamBoard(teamId: string) {
  const out = execFileSync('wsl.exe', [
    '-d', 'Ubuntu', '--',
    'bash', '-lc',
    `clawteam board show ${teamId} --json`,
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}
```

Poll every 2–5 seconds, or attach to the team's tmux session if you
want live output:

```bash
wsl -d Ubuntu -- tmux attach -t clawteam-<team-id>
```

(That's for human debugging; don't do it from code — use `tmux capture-pane`
instead.)

### 5.3 List available templates dynamically

```typescript
export function listTemplates() {
  const out = execFileSync('wsl.exe', [
    '-d', 'Ubuntu', '--',
    'bash', '-lc',
    'clawteam template list --json',
  ], { encoding: 'utf8' });
  return JSON.parse(out);
}
```

Genesis ships 7 templates by default (3 Genesis + 4 upstream). Users can
add their own by dropping TOML files into `~/.clawteam/templates/`.

### 5.4 Where do the outputs go?

- Agent-edited files: inside `--repo` (Windows path is visible if it's
  under `/mnt/c/...`, otherwise stays in the VM/WSL filesystem).
- Logs: `~/.clawteam/logs/<team-id>/` inside the sandbox.
- Artifacts: defined per-template in the TOML.

Genesis docs recommend keeping the **repo inside WSL's ext4** for speed
(`~/projects/...`). Your Electron UI can surface those via `wsl.exe` file
streaming or use the built-in Windows `\\wsl$\Ubuntu\home\<user>\projects\...`
UNC path.

---

## 6. Pattern B — OpenClaw Gateway HTTP

### 6.1 Enable the daemon

During Solaris first-run, if the user picked "remote-control mode", run:

```powershell
.\setup\setup-genesis.ps1 -OpenClawDaemon
```

This installs `openclaw-gateway.service` as a systemd user unit inside
the sandbox, enables `loginctl enable-linger`, and forwards
`127.0.0.1:18789` to the Windows host.

### 6.2 HTTP endpoints Solaris can call

The gateway's HTTP surface (verify against `https://docs.openclaw.ai`
which is the authoritative source — API evolves):

```typescript
// main/openclaw-client.ts
const BASE = 'http://127.0.0.1:18789';

export async function launchTeamViaGateway(params: {
  template: string;
  goal: string;
  repo?: string;
}) {
  const res = await fetch(`${BASE}/v1/teams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      command: `clawteam launch ${params.template} --goal ${JSON.stringify(params.goal)}${params.repo ? ` --repo ${params.repo}` : ''}`,
      approve: true,  // Solaris acts as a pre-approved caller
    }),
  });
  if (!res.ok) throw new Error(`gateway: ${res.status} ${await res.text()}`);
  return res.json();   // { team_id, tmux_session, status_url }
}

export async function streamTeamEvents(teamId: string, onEvent: (e: any) => void) {
  const res = await fetch(`${BASE}/v1/teams/${teamId}/events`, {
    headers: { accept: 'text/event-stream' },
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop()!;
    for (const p of parts) {
      const m = p.match(/^data:\s*(.*)$/m);
      if (m) onEvent(JSON.parse(m[1]));
    }
  }
}
```

### 6.3 Authenticate Solaris to the gateway

By default the gateway trusts localhost. For hardening:

```typescript
// Register Solaris as a pre-approved client once during first-run.
// This talks to the gateway's "exec approvals" subsystem.
await fetch(`${BASE}/v1/approvals`, {
  method: 'POST',
  body: JSON.stringify({
    client: 'solaris',
    allowlist: ['clawteam *', 'tmux *'],
  }),
});
```

See `@docs/openclaw-daemon.md` for the full DM pairing model.

### 6.4 When Solaris is closed

The gateway keeps running because of `loginctl enable-linger`. ClawTeam
teams launched via the gateway survive Solaris restarts. When Solaris
reopens, it can reconnect:

```typescript
const teams = await fetch(`${BASE}/v1/teams`).then(r => r.json());
// [{ team_id, template, status: 'running'|'done'|'failed', started_at, ... }]
```

Render a "resume where you left off" panel in the UI.

---

## 7. Pattern C — Claude Agent SDK + `clawteam` skill

This is the most ambitious and most future-proof pattern. You let the
Solaris agent *itself* decide when a multi-agent team is needed, using
Genesis's `clawteam` skill as the knowledge base.

### 7.1 Load the skill into the Agent SDK session

```typescript
// main/agent-init.ts
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pull the skill from the user's Genesis install (inside WSL)
function readClawteamSkill(): string {
  const { execFileSync } = require('child_process');
  return execFileSync('wsl.exe', [
    '-d', 'Ubuntu', '--',
    'cat', '/home/$USER/.claude/skills/clawteam/SKILL.md',
  ], { encoding: 'utf8' });
}

const systemPrompt = `You are Solaris, a desktop coding companion.
When the user asks you to build something non-trivial (multi-file,
multi-hour), you can delegate to a ClawTeam team of Claude Code agents.

Here is the clawteam skill — follow it for orchestration decisions:

${readClawteamSkill()}

Guardrails:
- Only call the launch_team tool for tasks the user has explicitly
  approved via the UI "Launch Team" button.
- After launch, switch to reporting mode; poll get_team_status every 30s.
- Never shell out to anything other than the two provided tools.`;
```

### 7.2 Expose two tools to the SDK

```typescript
const tools: Anthropic.Tool[] = [
  {
    name: 'launch_team',
    description: 'Spawn a multi-agent Claude Code team via ClawTeam. '
               + 'Use when the task is large enough to benefit from parallelism.',
    input_schema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: [
          'genesis-coder', 'finance-desk', 'deep-research',
          'code-review', 'hedge-fund', 'research-paper', 'strategy-room',
        ]},
        goal:    { type: 'string' },
        repo:    { type: 'string' },
      },
      required: ['template', 'goal'],
    },
  },
  {
    name: 'get_team_status',
    description: 'Read the current status of a running ClawTeam team.',
    input_schema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
    },
  },
];
```

### 7.3 Handle tool calls

```typescript
async function handleToolUse(block: Anthropic.ToolUseBlock) {
  if (block.name === 'launch_team') {
    const result = await launchTeam(block.input as any,
      (log) => mainWindow.webContents.send('team-log', log));
    return { team_id: result.teamId, status: 'running' };
  }
  if (block.name === 'get_team_status') {
    const board = readTeamBoard((block.input as any).team_id);
    return board;
  }
}
```

The Solaris agent will now *reason* about when to spawn a team, check
progress, and relay summaries. Meanwhile your Electron UI shows live
tmux panes, board state, and artifact links.

### 7.4 Key nuance — the skill is for *Claude Code*, not *Agent SDK*

Genesis's `clawteam` skill was written for Claude Code's execution
model (bash tool, file tool). The Agent SDK has a different tool
interface. **Adapt the skill text** before feeding it to the SDK:

- Replace `Bash(clawteam ...)` references with your `launch_team` tool name.
- Drop the `Bash(tmux ...)` mention (you won't let the SDK shell directly).
- Keep the conceptual parts — when to use which template, how to phrase goals.

Or: rewrite a Solaris-specific version as `solaris-skills/clawteam.md`
tailored to your SDK tool names, and keep the Genesis skill only on the
Claude Code side.

---

## 8. Authentication model

Solaris and Genesis use **separate** authentication by default:

| Component | Auth |
|---|---|
| Solaris (Agent SDK) | `ANTHROPIC_API_KEY` — your user's Anthropic key, entered in Solaris settings. |
| Claude Code inside WSL (spawned by ClawTeam) | Ollama Cloud via `ollama signin` + `ANTHROPIC_BASE_URL=http://host.docker.internal:11434`. **No API key.** |

This is intentional. Genesis's default is to route Claude Code through
the user's local Ollama (which can proxy Ollama Cloud), so coding-agent
requests don't burn Anthropic API credits. Solaris keeps its own
Anthropic key for high-quality conversational UX.

**Alternative: make both use the same Anthropic key.** Rewrite the WSL
`~/.claude/settings.json` `env` block from Solaris's first-run wizard:

```typescript
// Let Solaris share its Anthropic key with Claude Code inside WSL
const key = await anthropicKeyFromUser();
execFileSync('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', '-lc',
  `jq '.env.ANTHROPIC_API_KEY=$KEY | del(.env.ANTHROPIC_AUTH_TOKEN) | del(.env.ANTHROPIC_BASE_URL)' \
     --arg KEY '${key}' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json`,
], { stdio: 'inherit' });
```

Genesis ships `@setup\setup-provider.ps1` which does exactly this via a
friendlier UI — you can invoke it from Solaris too:

```powershell
# From inside Solaris main process
powershell.exe -File "$env:USERPROFILE\genesis\setup\setup-provider.ps1" -Provider Anthropic -ApiKey "sk-..."
```

Users can switch between Ollama Cloud and direct Anthropic at any time
without reinstalling Genesis.

---

## 9. Recommended end-to-end flow

### First launch of Solaris
1. Detect state (`detectGenesis()`).
2. If WSL absent → offer to enable it (needs reboot on old Windows).
3. If Genesis absent → show wizard: "Solaris needs a Linux sandbox for
   heavy coding tasks. Install? (~15 min, one time)." On accept, run
   `bootstrap.ps1` with progress pane.
4. After install, run `setup-provider.ps1` to configure Claude Code's
   auth mode (share Solaris's key vs Ollama Cloud).
5. Optional: offer `-OpenClawDaemon` install for remote-control mode.

### Daily use
1. User chats with Solaris agent.
2. Agent decides a task is team-worthy, calls `launch_team` tool.
3. Solaris spawns the team via Pattern A or B.
4. Electron UI shows live board / tmux panes.
5. On completion, Solaris summarizes results to the user.

### Pause & resume
- Pattern A: teams are tied to the tmux session. If user reboots, that
  session is lost unless they re-attach before reboot.
- Pattern B: teams persist through reboots (gateway + `enable-linger`).
  Reconnect via `GET /v1/teams` on next Solaris launch.

---

## 10. What to hand your engineers

1. **This document**, at `docs/solaris-integration.md` in the Genesis repo.
2. **The Genesis repo itself** — they need `provision.sh`, `catalog/*.json`,
   `skills/clawteam/SKILL.md`, and `setup/setup-provider.ps1` as
   reference implementations.
3. **A decision on Pattern A vs B vs C** — I recommend starting with A,
   adding B when the daemon is stable on your support matrix, using C
   only for the "agent autonomously orchestrates" feature.
4. **Branding on the install prompt** — when Solaris triggers
   `bootstrap.ps1`, the PowerShell window is Genesis-branded. If that's
   jarring, fork Genesis and ship your own branded bootstrap that
   calls the same `provision.sh` underneath.

---

## 11. Reference quick-table

| Thing you want to do | Command / code |
|---|---|
| Install Genesis into WSL | `iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 \| iex` |
| Install into a VM instead | `.\setup\setup-genesis.ps1 -VMFirst` |
| Install + OpenClaw daemon | `.\setup\setup-genesis.ps1 -OpenClawDaemon` or `.\setup\setup-genesis.ps1 -VMFirst -OpenClawDaemon` |
| Switch Claude Code to direct Anthropic | `.\setup\setup-provider.ps1 -Provider Anthropic -ApiKey sk-...` |
| Launch a team from Node | `spawn('wsl.exe', ['-d','Ubuntu','--','clawteam','launch',...])` |
| Read team status | `wsl -d Ubuntu -- clawteam board show <id> --json` |
| Gateway HTTP base URL | `http://127.0.0.1:18789` |
| List templates | `wsl -d Ubuntu -- clawteam template list --json` |
| Add a custom template | Drop TOML into `~/.clawteam/templates/` inside WSL |

---

## 12. Known limitations (April 2026)

- **VM-first + OpenClaw daemon**: `openclaw onboard` fails its Ollama
  probe under VirtualBox NAT (Node fetch quirk). Works under WSL.
  See `@docs/openclaw-daemon.md` for the workaround.
- **Claude Code 2.1.x** is the verified baseline. Newer versions may
  change the `~/.claude/settings.json` schema; test before upgrading.
- **ClawTeam v0.3.0+openclaw1** is the verified baseline. Future
  upstream versions may add/remove template options.
- **Windows ARM64** is untested. Genesis targets x64 WSL/VirtualBox.

---

## 13. Related docs

- `@README.md` — Genesis overview, WSL vs VM backend tradeoffs.
- `@docs\openclaw-daemon.md` — full daemon install, Telegram pairing,
  security model, troubleshooting.
- `@docs\vm-snapshots.md` — snapshot/restore workflow for risky runs.
- `@phase2\01-architecture.md` — deeper architectural rationale for
  Claude Code + OpenClaw + ClawTeam composition.
- `@skills\clawteam\SKILL.md` — the reference skill that tells agents
  how to use ClawTeam (adapt for Pattern C).
- `@catalog\templates.json` — the seven teams Genesis ships.

Questions? The Genesis repo is at https://github.com/netflypsb/genesis —
file issues or PRs there.
