# Genesis — Research Notes (pre-implementation)

Captured before writing the v4 setup wizard. Every claim has a source; where sources disagree, the conflict is flagged.

---

## 1. Can MCP servers be installed **once** and be available in **every** project?

**Yes — use Claude Code's `user` scope.** This is officially supported today; no hack required.

Claude Code has three MCP scopes (source: [Claude Code — Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)):

| Scope     | Stored in                       | Visible to                       |
|-----------|----------------------------------|----------------------------------|
| `local`   | `~/.claude.json` (keyed by CWD)  | Only you, only in that project   |
| `project` | `.mcp.json` at repo root         | Everyone who clones the repo     |
| `user`    | `~/.claude.json` (top level)     | **You, in every project**        |

Precedence: `local > project > user > plugins > claude.ai connectors`.

### Why your current setup isn't global
Your `settings.json` example is the **local/project** form. That block lives under `projects["/path/to/project"].mcpServers` in `~/.claude.json` (or in a project `.mcp.json`). Claude Code ignores it outside that project.

### What to do in the wizard
Register each MCP once with:
```bash
claude mcp add --scope user <name> -- <command> [args...]
# e.g.
claude mcp add --scope user fetch -- uvx mcp-server-fetch
claude mcp add --scope user git   -- uvx mcp-server-git
claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest
```
`claude mcp list` will then show them in any directory.

**Decision:** use `claude mcp add --scope user`. Fall back to direct edit of `~/.claude.json` only if the `--scope` flag is missing on an older CLI.

### OpenClaw / ClawTeam equivalents
- **OpenClaw:** no direct MCP registry; its skills live in `~/.openclaw/workspace/skills/<name>/SKILL.md` (source: [ClawTeam-OpenClaw Install §4](https://github.com/win4r/ClawTeam-OpenClaw#install)). Skills are already global per user.
- **Hermes (OpenClaw sub-agent):** config in `~/.hermes/config.yaml`; "spawned Hermes workers automatically inherit MCP servers configured in `~/.hermes/config.yaml`" (same source, §5b). So MCPs defined there are already global.
- **ClawTeam:** does not host MCPs itself. It spawns agents; each spawned agent inherits whatever global config its own CLI reads (Claude `~/.claude.json`, OpenClaw `~/.openclaw/`, Hermes `~/.hermes/`).

**Bottom line:** once MCPs are added at user-scope for each underlying agent CLI, ClawTeam-spawned sub-agents get them for free.

---

## 2. Dependency matrix

Sources: [ClawTeam-OpenClaw README](https://github.com/win4r/ClawTeam-OpenClaw), [Ollama → Claude Code integration](https://docs.ollama.com/integrations/claude-code), [Claude Code docs](https://code.claude.com/docs/en/overview), [OpenClaw DeepWiki](https://deepwiki.com/openclaw/openclaw).

| Component     | Runtime    | Install                                                                 | Notes |
|---------------|------------|-------------------------------------------------------------------------|-------|
| Python        | 3.10+      | apt / winget                                                            | Required by ClawTeam. |
| Node.js       | 20+ (22 recommended) | NodeSource deb / winget / nvm                                 | Required by OpenClaw + MCPs. |
| uv (Astral)   | latest     | `curl -LsSf https://astral.sh/uv/install.sh \| sh`                      | Used to run `uvx mcp-server-fetch/git`. |
| tmux          | any        | apt / brew                                                              | **Linux/macOS/WSL only**; ClawTeam defaults to subprocess backend on Windows. |
| git           | any        | apt / winget                                                            | Required by ClawTeam worktree isolation. |
| Claude Code   | latest     | `curl -fsSL https://claude.ai/install.sh \| bash`                       | Or `npm i -g @anthropic-ai/claude-code`. |
| OpenClaw      | latest     | `npm i -g openclaw@latest`                                              | Gateway default port 18789. |
| ClawTeam      | v0.3+      | `git clone win4r/ClawTeam-OpenClaw && pip install -e .`                 | **Do NOT** `pip install clawteam` (upstream PyPI lacks OpenClaw adapter); **do NOT** `npm i -g clawteam` (name-squat by a9logic). |
| Playwright browsers | chromium | `npx playwright install --with-deps chromium`                     | ~300 MB; needed by `@playwright/mcp`. |
| Ollama desktop | latest    | winget `Ollama.Ollama` (host) or `curl -fsSL https://ollama.com/install.sh \| sh` (Linux) | Only needed if using Ollama Cloud or local models. |

### Runtime conflicts
- `pip install clawteam` → wrong package (upstream). Must use local editable install.
- `npm install -g clawteam` → squatter. Must be uninstalled if present.

---

## 3. Ollama Cloud auth — do we need an API key?

**Two officially supported paths.** Sources: [Ollama API — Authentication](https://docs.ollama.com/api/authentication), [Ollama — Claude Code integration](https://docs.ollama.com/integrations/claude-code).

### Path A — Signed-in (no API key; **recommended**)
```bash
ollama signin                        # one-time, opens browser
ollama launch claude                 # wires env vars + picks a model
# or: ollama launch claude --model kimi-k2.5:cloud
```
`ollama launch claude` sets `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, `ANTHROPIC_BASE_URL=http://localhost:11434` for the spawned process. This is what your working `setup-claude.ps1` effectively reproduces.

### Path B — API key (also supported)
```bash
export OLLAMA_API_KEY=<key-from-ollama.com/settings/keys>
# For Claude Code's Anthropic-compat shim:
export ANTHROPIC_AUTH_TOKEN=$OLLAMA_API_KEY
export ANTHROPIC_API_KEY=""          # must be empty; see ollama/ollama#13854
export ANTHROPIC_BASE_URL=https://ollama.com    # cloud endpoint, not localhost
```
Known gotcha: you must set `ANTHROPIC_AUTH_TOKEN`, **not** `ANTHROPIC_API_KEY`, or you get 401s (sources: [ollama/ollama#13776](https://github.com/ollama/ollama/issues/13776), [#13854](https://github.com/ollama/ollama/issues/13854)).

### Decision
Default to **Path A** (signed-in). Offer Path B as opt-in for CI/headless use cases where `ollama signin` can't be interactive.

---

## 4. Isolation model — WSL2 primary, Vagrant VM fallback (per your choice)

### WSL2 primary (default)
- Already works on Windows Home + Pro.
- Shares filesystem via `/mnt/c` and `\\wsl$\<distro>`.
- tmux works natively; full ClawTeam visual workflow available.
- Ubuntu 22.04 or 24.04 via `wsl --install -d Ubuntu-24.04`.
- Isolation: process-level + separate filesystem. **Not a full VM**; a rogue agent with bash can still write to `/mnt/c`.

### Vagrant + VirtualBox fallback (opt-in, "stronger isolation")
Recommended only when user explicitly wants hardware-level isolation.

**Critical conflict:** VirtualBox 7.x on Windows does support Hyper-V-mode acceleration, but performance degrades significantly when Hyper-V/WSL2 is active. Two options:
1. Accept the perf hit (workable for dev, not for heavy agent swarms).
2. Use **Vagrant `hyperv` provider** on Win Pro/Enterprise (no Hyper-V/WSL2 conflict, same persistence model). Caveat: Hyper-V networking is less flexible (no NAT by default; defaultSwitch or user-created internal switch needed).

Vagrantfile shape (matches the user-provided snippet with minor hardening):
```ruby
Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/jammy64"
  config.vm.hostname = "genesis"
  config.vm.network "forwarded_port", guest: 18789, host: 18789  # OpenClaw
  config.vm.network "forwarded_port", guest: 8080,  host: 8080   # ClawTeam board
  config.vm.network "forwarded_port", guest: 11434, host: 11435  # Ollama (shift to avoid host clash)
  config.vm.synced_folder ".", "/vagrant", type: "virtualbox"
  config.vm.provider "virtualbox" do |vb|
    vb.memory = 8192   # ClawTeam swarms chew RAM; 4 GB is the floor
    vb.cpus   = 4
  end
  config.vm.provision "shell", path: "provision.sh"
end
```
Provisioning is externalized to `provision.sh` so the same script can also run inside WSL — one source of truth for both backends.

### Decision
Wizard has two modes:
- `--mode wsl` (default): use WSL2 + Ubuntu; run `provision.sh` inside the distro.
- `--mode vm`: install VirtualBox + Vagrant via winget, drop the Vagrantfile + provision.sh, `vagrant up`, `vagrant ssh`.

Both modes share `provision.sh`, which is the single canonical installer for Python/Node/tmux/Claude Code/OpenClaw/ClawTeam/uv/Playwright/MCPs/skills.

---

## 5. Skills — what's in `c:\Users\netfl\SKYNET\genesis\skills` and where they go

Layout observed: `advertisement/`, `docx/`, `frontend-design/`, `pdf/`, `pptx/`, `xlsx/` — Claude Code skill directories (each with `SKILL.md`).

### Install destinations
- **Claude Code global:** `~/.claude/skills/<skill>/SKILL.md` (source: [Claude Code — Skills](https://code.claude.com/docs/en/skills)).
- **OpenClaw global:** `~/.openclaw/workspace/skills/<skill>/SKILL.md`.
- **Hermes global:** `~/.hermes/skills/openclaw-imports/<skill>/SKILL.md`.

### Wizard behavior
After cloning the Genesis repo into the sandbox, copy selected skills from `./skills/*/` into whichever agent's global skills dir the user chose. Default: Claude Code, all skills. Offer checkbox list for opt-out.

---

## 6. Repo hygiene (what to gitignore, what to commit)

### Commit (essential)
- `setup/` (wizard scripts)
- `provision.sh` (shared Linux installer)
- `Vagrantfile` (VM fallback)
- `mcp/registry.json` (MCP manifest)
- `mcp/<vendored-subtrees>/` (flattened, per your choice — nested `.git` dirs removed)
- `agents/*.md` (agent role prompts)
- `skills/**` (bundled skills)
- `config/settings.sample.json`
- `docs/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `.github/workflows/ci.yml`

### Gitignore (non-essential)
- `mcp/*/node_modules/`, `mcp/*/dist/`, `mcp/*/build/`, `mcp/*/.git/`, `mcp/*/packages/*/node_modules/`
- `mcp/*/package-lock.json` is debatable — keep for reproducibility, drop if bloat is real (playwright-mcp's is 117 KB, keep it)
- `**/__pycache__/`, `**/*.pyc`, `**/.venv/`, `**/venv/`
- `plan01/` — historical planning notes, not needed in the public repo
- Root-level `setup-claude.ps1`, `setup-clawteam-wsl.ps1`, `settings.json` — superseded by `setup/` scaffolding; delete rather than ignore
- `*.bak`, `*.log`, `.vscode/`, `.idea/`, `Thumbs.db`, `.DS_Store`

### Flatten plan for vendored MCPs
For each of `mcp/playwright-mcp/`, `mcp/K-01-mcp/k-01/`:
1. `Remove-Item -Recurse -Force .git` inside the clone.
2. `Remove-Item -Recurse -Force node_modules, dist, build` if present.
3. Commit the remaining source to the Genesis repo.

---

## 7. Open questions I still want to confirm before coding

1. **VM mode default RAM/CPU.** The pasted snippet used 4 GB / 2 CPU. ClawTeam spawning 8 Claude workers will OOM there. My recommendation: **8 GB / 4 CPU** default, prompt before provisioning on machines with <16 GB physical RAM.
2. **Ollama host vs. guest.** For WSL mode, should Ollama run on Windows (and be reached via mirrored networking / `host.docker.internal`) or inside WSL? My recommendation: **Windows host**, because Ollama Desktop's `ollama signin` flow is browser-based and far smoother on the host.
3. **Which agent CLIs to install by default?** OpenClaw requires a separate login flow; Claude Code via Ollama needs only `ollama signin`. My recommendation: **install all three (Claude Code, OpenClaw, ClawTeam)** eagerly, prompt the user once for which to `signin`/`onboard` during post-install.
4. **Skills bundle opt-in.** Your `skills/` dir has 6 skill families (docx, pdf, pptx, xlsx, advertisement, frontend-design). Install all by default, or let the user pick? My recommendation: **all by default**, with a `--skip-skills` flag.

---

## 8. Sources (quick index)

- Claude Code MCP scopes → <https://code.claude.com/docs/en/mcp>
- Claude Code skills → <https://code.claude.com/docs/en/skills>
- Ollama ↔ Claude Code → <https://docs.ollama.com/integrations/claude-code>
- Ollama auth → <https://docs.ollama.com/api/authentication>
- ClawTeam-OpenClaw (win4r fork) → <https://github.com/win4r/ClawTeam-OpenClaw>
- ClawTeam upstream → <https://github.com/HKUDS/ClawTeam>
- OpenClaw → <https://github.com/openclaw/openclaw>
- Ollama Cloud auth gotcha → <https://github.com/ollama/ollama/issues/13776>, <https://github.com/ollama/ollama/issues/13854>
