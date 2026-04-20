#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Genesis provisioning script (shared between WSL2 and Vagrant VM backends).
#
# Idempotent. Safe to re-run. Expects Ubuntu 22.04 or 24.04.
#
# Env knobs (all optional):
#   GENESIS_REPO_URL      default: https://github.com/netflypsb/genesis.git
#   GENESIS_REPO_REF      default: main
#   GENESIS_HOME          default: $HOME/genesis
#   GENESIS_SKIP_SKILLS   "1" to skip bundled skills
#   GENESIS_SKIP_MCPS     "1" to skip MCP user-scope registration
#   GENESIS_SKIP_OPENCLAW "1" to skip OpenClaw + ClawTeam-OpenClaw
#   GENESIS_OLLAMA_HOST   default: http://host.docker.internal:11434 inside
#                         WSL (mirrored) or http://10.0.2.2:11434 inside
#                         VirtualBox NAT. Wizard sets this explicitly.
# ---------------------------------------------------------------------------
set -euo pipefail

GENESIS_REPO_URL="${GENESIS_REPO_URL:-https://github.com/netflypsb/genesis.git}"
GENESIS_REPO_REF="${GENESIS_REPO_REF:-main}"
GENESIS_HOME="${GENESIS_HOME:-$HOME/genesis}"
GENESIS_SKIP_SKILLS="${GENESIS_SKIP_SKILLS:-0}"
GENESIS_SKIP_MCPS="${GENESIS_SKIP_MCPS:-0}"
GENESIS_SKIP_OPENCLAW="${GENESIS_SKIP_OPENCLAW:-0}"
GENESIS_OLLAMA_HOST="${GENESIS_OLLAMA_HOST:-}"

# Auto-detect the best Ollama endpoint if not provided.
# Order of preference:
#   1. WSL mirrored networking: localhost reaches Windows-side Ollama directly.
#   2. WSL NAT: host.docker.internal routes to the Windows host.
#   3. VirtualBox NAT: 10.0.2.2 is the host from a guest VM.
if [[ -z "$GENESIS_OLLAMA_HOST" ]]; then
  for cand in "http://localhost:11434" "http://host.docker.internal:11434" "http://10.0.2.2:11434"; do
    if curl -fsS --max-time 2 "${cand}/api/tags" >/dev/null 2>&1; then
      GENESIS_OLLAMA_HOST="$cand"
      break
    fi
  done
  # Last-resort fallback if none reachable (non-fatal; user can edit settings.json)
  GENESIS_OLLAMA_HOST="${GENESIS_OLLAMA_HOST:-http://host.docker.internal:11434}"
fi

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
step() { printf '  \033[1;32m•\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*" >&2; }

need_sudo() {
  if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi
}

apt_install() {
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

# --------------------------------------------------------------- Phase 1: OS
log "Phase 1 — base OS packages"
need_sudo
$SUDO apt-get update -qq
apt_install ca-certificates curl git tmux build-essential pkg-config \
            python3 python3-pip python3-venv python3-dev pipx \
            unzip jq xdg-utils
# pipx user path (idempotent)
pipx ensurepath >/dev/null 2>&1 || true

# --------------------------------------------------------- Phase 2: Node 22
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | tr -d v | cut -d. -f1)" -lt 20 ]]; then
  log "Phase 2 — Node.js 22 via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  apt_install nodejs
else
  step "Node $(node -v) already installed"
fi

# ------------------------------------------------------------ Phase 3: uv
if ! command -v uv >/dev/null 2>&1; then
  log "Phase 3 — uv (Astral)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  if ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  fi
else
  step "uv already installed ($(uv --version))"
fi

# -------------------------------------------------------- Phase 4: Claude Code
if ! command -v claude >/dev/null 2>&1; then
  log "Phase 4 — Claude Code"
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
else
  step "Claude Code already installed ($(claude --version 2>/dev/null || echo '?'))"
fi

# ---------------------------------------------------- Phase 5: OpenClaw + ClawTeam
if [[ "$GENESIS_SKIP_OPENCLAW" != "1" ]]; then
  if ! command -v openclaw >/dev/null 2>&1; then
    log "Phase 5a — OpenClaw (global npm)"
    $SUDO npm install -g openclaw@latest
  else
    step "OpenClaw already installed ($(openclaw --version 2>/dev/null || echo '?'))"
  fi

  log "Phase 5b — Genesis repo clone"
  if [[ ! -d "$GENESIS_HOME/.git" ]]; then
    git clone --depth 1 --branch "$GENESIS_REPO_REF" "$GENESIS_REPO_URL" "$GENESIS_HOME"
  else
    git -C "$GENESIS_HOME" fetch --depth 1 origin "$GENESIS_REPO_REF"
    git -C "$GENESIS_HOME" reset --hard FETCH_HEAD
  fi

  log "Phase 5c — ClawTeam-OpenClaw (pipx editable install)"
  CT_DIR="$HOME/ClawTeam-OpenClaw"
  if [[ ! -d "$CT_DIR/.git" ]]; then
    git clone --depth 1 https://github.com/win4r/ClawTeam-OpenClaw.git "$CT_DIR"
  else
    git -C "$CT_DIR" fetch --depth 1 origin main
    git -C "$CT_DIR" reset --hard FETCH_HEAD
  fi
  # pipx handles PEP 668 correctly: isolated venv, bin on $HOME/.local/bin.
  # Re-install is idempotent when we pass --force.
  if pipx list 2>/dev/null | grep -q '^package clawteam'; then
    pipx reinstall clawteam --python python3 >/dev/null || pipx install --force --editable "$CT_DIR"
  else
    pipx install --editable "$CT_DIR"
  fi
  export PATH="$HOME/.local/bin:$PATH"
  if ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  fi
  if ! command -v clawteam >/dev/null 2>&1; then
    warn "clawteam not on PATH after pipx install; open a new shell or 'source ~/.bashrc'"
  fi
fi

# ---------------------------------------------------- Phase 6: Playwright
log "Phase 6 — Playwright browsers (chromium, eager)"
if ! npx --yes playwright --version >/dev/null 2>&1; then
  $SUDO npm install -g playwright
fi
npx --yes playwright install --with-deps chromium || warn "playwright install failed; continue"

# ---------------------------------------------------- Phase 7: MCP user-scope
if [[ "$GENESIS_SKIP_MCPS" != "1" ]]; then
  log "Phase 7 — register MCP servers at user scope"
  # claude mcp add is idempotent-ish: re-adding overwrites. Ignore duplicates.
  claude mcp add --scope user fetch      -- uvx mcp-server-fetch 2>/dev/null || \
    claude mcp add --scope user -- fetch uvx mcp-server-fetch || true
  claude mcp add --scope user git        -- uvx mcp-server-git  2>/dev/null || true
  claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest 2>/dev/null || true
  step "Registered: $(claude mcp list 2>/dev/null | wc -l) entries"
fi

# ---------------------------------------------------- Phase 8: Skills
if [[ "$GENESIS_SKIP_SKILLS" != "1" && -d "$GENESIS_HOME/skills" ]]; then
  log "Phase 8 — bundled Claude Code skills"
  mkdir -p "$HOME/.claude/skills"
  shopt -s nullglob
  for skill_dir in "$GENESIS_HOME"/skills/*/; do
    name=$(basename "$skill_dir")
    if [[ -f "$skill_dir/SKILL.md" ]]; then
      mkdir -p "$HOME/.claude/skills/$name"
      cp -r "$skill_dir"/. "$HOME/.claude/skills/$name/"
      step "skill: $name"
    fi
  done
  shopt -u nullglob
fi

# ---------------------------------------------------- Phase 9: Claude Code env
log "Phase 9 — Claude Code Ollama Cloud wiring"
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR"
# Write or update env vars in ~/.claude/settings.json (user-scope)
# We only touch keys we own; don't clobber MCPs registered above.
python3 - <<PY
import json, os, pathlib
p = pathlib.Path(os.path.expanduser("~/.claude/settings.json"))
data = {}
if p.exists():
    try: data = json.loads(p.read_text())
    except Exception: data = {}
data.setdefault("env", {})
data["env"].update({
    "ANTHROPIC_AUTH_TOKEN": "ollama",
    "ANTHROPIC_API_KEY":   "",
    "ANTHROPIC_BASE_URL":  "${GENESIS_OLLAMA_HOST}",
})
p.write_text(json.dumps(data, indent=2))
print(f"wrote {p}")
PY

# ---------------------------------------------------- Phase 10: agent files
if [[ -d "$GENESIS_HOME/agents" ]]; then
  log "Phase 10 — agent prompts → ~/.claude/agents/"
  mkdir -p "$HOME/.claude/agents"
  cp -f "$GENESIS_HOME"/agents/*.md "$HOME/.claude/agents/" 2>/dev/null || true
fi

# ---------------------------------------------------- Phase 11: summary
log "Summary"
printf '  claude:    %s\n'  "$(command -v claude   || echo 'MISSING')"
printf '  openclaw:  %s\n'  "$(command -v openclaw || echo 'skipped')"
printf '  clawteam:  %s\n'  "$(command -v clawteam || echo 'skipped')"
printf '  uv:        %s\n'  "$(command -v uv       || echo 'MISSING')"
printf '  node:      %s\n'  "$(node -v 2>/dev/null || echo 'MISSING')"
printf '  ollama @:  %s\n'  "$GENESIS_OLLAMA_HOST"
printf '  skills:    %s under ~/.claude/skills\n' "$(ls -1 "$HOME/.claude/skills" 2>/dev/null | wc -l)"
log "Done. Next: 'ollama signin' on the Windows host (if not already), then 'claude mcp list' to verify."
