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
#   GENESIS_ENABLE        comma-separated list of catalog item names to
#                         force-enable (overrides `default: false`).
#   GENESIS_DISABLE       comma-separated list of catalog item names to
#                         force-disable (overrides `default: true`).
# ---------------------------------------------------------------------------
set -euo pipefail

GENESIS_REPO_URL="${GENESIS_REPO_URL:-https://github.com/netflypsb/genesis.git}"
GENESIS_REPO_REF="${GENESIS_REPO_REF:-main}"
GENESIS_HOME="${GENESIS_HOME:-$HOME/genesis}"
GENESIS_SKIP_SKILLS="${GENESIS_SKIP_SKILLS:-0}"
GENESIS_SKIP_MCPS="${GENESIS_SKIP_MCPS:-0}"
GENESIS_SKIP_OPENCLAW="${GENESIS_SKIP_OPENCLAW:-0}"
GENESIS_OPENCLAW_DAEMON="${GENESIS_OPENCLAW_DAEMON:-0}"
GENESIS_OLLAMA_HOST="${GENESIS_OLLAMA_HOST:-}"
GENESIS_ENABLE="${GENESIS_ENABLE:-}"
GENESIS_DISABLE="${GENESIS_DISABLE:-}"
GENESIS_VM_MODE="${GENESIS_VM_MODE:-0}"

# Auto-detect VM mode if not set (Vagrant leaves telltale markers).
if [[ "$GENESIS_VM_MODE" != "1" ]]; then
  if [[ -f /etc/vagrant_box.info ]] || [[ "$USER" == "vagrant" ]] || [[ -d /vagrant ]]; then
    GENESIS_VM_MODE=1
  fi
fi

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

# ---------------------------------------------------------------- catalog
# Resolution rule for a catalog item's effective enabled state:
#   name in GENESIS_DISABLE  -> disabled (highest priority)
#   name in GENESIS_ENABLE   -> enabled
#   else                     -> item's `default` field
catalog_is_enabled() {
  local name="$1" default="$2"
  if [[ ",${GENESIS_DISABLE}," == *",${name},"* ]]; then return 1; fi
  if [[ ",${GENESIS_ENABLE}," == *",${name},"* ]]; then  return 0; fi
  [[ "$default" == "true" ]]
}

# Emit each enabled item as a compact JSON line from a catalog file.
# Args: catalog file (absolute path)
catalog_enabled_items() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local item name default
  while IFS= read -r item; do
    name=$(echo "$item"    | jq -r '.name')
    default=$(echo "$item" | jq -r '.default')
    if catalog_is_enabled "$name" "$default"; then
      echo "$item"
    fi
  done < <(jq -c '.items[]' "$file")
}

# Expand a leading ~/ in a path to $HOME/.
#
# BUG FIX: bash's `${p#~/}` performs tilde expansion on the pattern itself
# (it becomes `/home/you/` which doesn't match a literal leading `~/`), so
# the tilde was left in place producing paths like `/home/you/~/.claude/...`.
# Using positional substring `${p:2}` skips the literal "~/" safely.
expand_home() {
  local p="$1"
  if [[ "$p" == "~/"* ]]; then
    echo "$HOME/${p:2}"
  else
    echo "$p"
  fi
}

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
  if [[ "$GENESIS_VM_MODE" == "1" ]]; then
    # VM mode: /vagrant is the host's checkout (read-only mount). Source
    # of truth lives on Windows; users update via `git pull` there, then
    # `vagrant provision` to re-run. Nothing to do here.
    step "VM mode: /vagrant already mirrors the host checkout — skipping"
  elif [[ ! -d "$GENESIS_HOME/.git" ]]; then
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

# ---------------------------------------------------- Phase 5d: OpenClaw daemon (opt-in)
# Runs BEFORE Phase 8 (skills) so that ~/.openclaw/workspace/ exists when
# the catalog's also_install_to field copies the clawteam skill into the
# OpenClaw workspace.
GENESIS_GATEWAY_STATUS="not-installed"
if [[ "$GENESIS_OPENCLAW_DAEMON" == "1" ]]; then
  log "Phase 5d — OpenClaw gateway daemon (systemd --user)"
  if ! command -v openclaw >/dev/null 2>&1; then
    warn "openclaw not installed (did Phase 5a run?); skipping daemon setup"
    GENESIS_GATEWAY_STATUS="missing-openclaw"
  else
    mkdir -p "$HOME/.openclaw"
    # Non-interactive onboard. --auth-choice ollama tells openclaw to use
    # the Ollama-compatible endpoint; Phase 9 writes the actual model/host
    # into ~/.claude/settings.json which openclaw picks up. We skip all
    # interactive features so provisioning never blocks:
    #   --skip-channels : user pairs Telegram/Discord post-install
    #   --skip-search   : no web-search plugin setup
    #   --skip-ui       : no Control UI prompts
    #   --skip-health   : no interactive healthcheck (we verify below)
    step "openclaw onboard --install-daemon --non-interactive"
    if openclaw onboard \
         --install-daemon \
         --non-interactive \
         --auth-choice ollama \
         --workspace "$HOME/.openclaw/workspace" \
         --skip-channels --skip-search --skip-ui --skip-health \
         --json > "$HOME/.openclaw/onboard.json" 2>"$HOME/.openclaw/onboard.err"; then
      step "onboard OK -> $HOME/.openclaw/onboard.json"
    else
      warn "openclaw onboard failed; see $HOME/.openclaw/onboard.err"
      tail -n 20 "$HOME/.openclaw/onboard.err" 2>/dev/null | sed 's/^/    /'
      GENESIS_GATEWAY_STATUS="onboard-failed"
    fi

    # Enable linger so the gateway survives logout. Requires sudo but is
    # idempotent — ignore failure on systems where the caller can't sudo.
    if loginctl show-user "$USER" 2>/dev/null | grep -q '^Linger=yes$'; then
      step "loginctl: linger already enabled for $USER"
    else
      if $SUDO loginctl enable-linger "$USER" 2>/dev/null; then
        step "loginctl: enabled linger for $USER (service survives logout)"
      else
        warn "could not enable-linger for $USER; daemon will stop on logout"
      fi
    fi

    # Reload and enable the unit installed by onboard. Unit name per
    # docs.openclaw.ai: openclaw-gateway.service under --user scope.
    if systemctl --user daemon-reload 2>/dev/null; then
      if systemctl --user enable --now openclaw-gateway.service 2>/dev/null; then
        step "systemctl --user: openclaw-gateway enabled and started"
      else
        warn "systemctl --user enable openclaw-gateway failed; inspect with 'systemctl --user status openclaw-gateway'"
      fi
    else
      warn "systemctl --user not available (is systemd running as PID 1?)"
    fi

    # Health probe — gateway listens on 127.0.0.1:18789 by default.
    # Give systemd ~5s to spin it up before probing.
    sleep 5
    if systemctl --user is-active --quiet openclaw-gateway.service 2>/dev/null; then
      GENESIS_GATEWAY_STATUS="active"
      step "gateway: active on 127.0.0.1:18789"
    else
      GENESIS_GATEWAY_STATUS="inactive"
      warn "gateway: inactive. Debug: systemctl --user status openclaw-gateway"
    fi
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
  CAT_MCPS="$GENESIS_HOME/catalog/mcps.json"
  if [[ -f "$CAT_MCPS" ]]; then
    # Catalog-driven path (milestone 2.0+).
    while IFS= read -r item; do
      [[ -z "$item" ]] && continue
      name=$(echo "$item"   | jq -r '.name')
      scope=$(echo "$item"  | jq -r '.scope // "user"')
      cmd=$(echo "$item"    | jq -r '.command')
      args=$(echo "$item"   | jq -r '.args | join(" ")')
      inst_kind=$(echo "$item" | jq -r '.install.kind // ""')

      # Optional install step for opt-in MCPs that aren't just uvx/npx runners.
      case "$inst_kind" in
        pipx)
          pkg=$(echo "$item" | jq -r '.install.package')
          if ! command -v "$cmd" >/dev/null 2>&1; then
            step "MCP: $name - installing $pkg via pipx..."
            pipx install "$pkg" >/dev/null || warn "pipx install $pkg failed; skipping $name"
          fi
          ;;
        git-node)
          repo=$(echo "$item"   | jq -r '.install.repo')
          path=$(expand_home "$(echo "$item" | jq -r '.install.path')")
          subdir=$(echo "$item" | jq -r '.install.subdir // ""')
          build=$(echo "$item"  | jq -r '.install.build // false')
          if [[ ! -d "$path" ]]; then
            step "MCP: $name - cloning $repo -> $path"
            git clone --depth 1 "$repo" "$path" 2>/dev/null || warn "git clone failed for $name"
          fi
          if [[ -d "$path" && "$build" == "true" ]]; then
            target="$path"
            [[ -n "$subdir" && -d "$path/$subdir" ]] && target="$path/$subdir"
            if [[ -f "$target/package.json" && ! -d "$target/node_modules" ]]; then
              step "MCP: $name - npm install + build in $target"
              (cd "$target" && npm install --silent 2>/dev/null && npm run build --silent 2>/dev/null) \
                || warn "npm install/build failed for $name"
            fi
          fi
          ;;
      esac

      # Skip registration if the command isn't on PATH (e.g. install failed).
      # Node-style MCPs (command=node) always register; skipping only applies
      # to CLI-style MCPs whose entry point is a single binary.
      if [[ "$cmd" != "node" && "$cmd" != "npx" && "$cmd" != "uvx" ]]; then
        if ! command -v "$cmd" >/dev/null 2>&1; then
          warn "MCP: $name - command '$cmd' not found after install; skipping registration"
          continue
        fi
      fi

      # shellcheck disable=SC2086
      claude mcp add --scope "$scope" "$name" -- $cmd $args 2>/dev/null || true
      step "MCP: $name ($cmd $args)"
    done < <(catalog_enabled_items "$CAT_MCPS")
  else
    # Legacy fallback: pre-catalog hardcoded list (matches v0.2.0 behavior).
    warn "catalog/mcps.json missing; using legacy hardcoded MCP list"
    claude mcp add --scope user fetch      -- uvx mcp-server-fetch 2>/dev/null || true
    claude mcp add --scope user git        -- uvx mcp-server-git  2>/dev/null || true
    claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest 2>/dev/null || true
  fi
  step "Registered: $(claude mcp list 2>/dev/null | wc -l) entries"
fi

# ---------------------------------------------------- Phase 8: Skills
if [[ "$GENESIS_SKIP_SKILLS" != "1" ]]; then
  log "Phase 8 — bundled Claude Code skills"
  mkdir -p "$HOME/.claude/skills"
  CAT_SKILLS="$GENESIS_HOME/catalog/skills.json"
  if [[ -f "$CAT_SKILLS" ]]; then
    # Catalog-driven path.
    while IFS= read -r item; do
      [[ -z "$item" ]] && continue
      name=$(echo "$item"    | jq -r '.name')
      source=$(echo "$item"  | jq -r '.source')
      dest=$(echo "$item"    | jq -r '.install_to // ""')
      also=$(echo "$item"    | jq -r '.also_install_to // ""')
      src="$GENESIS_HOME/$source"
      dst=$(expand_home "${dest:-$HOME/.claude/skills/$name}")
      if [[ -d "$src" && -f "$src/SKILL.md" ]]; then
        mkdir -p "$dst"
        cp -r "$src"/. "$dst/"
        step "skill: $name"
        # Optional secondary install (e.g. OpenClaw workspace). Only if the
        # parent dir exists — don't create ~/.openclaw for users who skipped it.
        if [[ -n "$also" ]]; then
          dst2=$(expand_home "$also")
          parent=$(dirname "$(dirname "$dst2")")  # two levels up (.../skills/<name> -> ...)
          if [[ -d "$parent" ]]; then
            mkdir -p "$dst2"
            cp -r "$src"/. "$dst2/"
            step "  also -> $dst2"
          fi
        fi
      else
        warn "skill '$name' source missing: $src"
      fi
    done < <(catalog_enabled_items "$CAT_SKILLS")
  elif [[ -d "$GENESIS_HOME/skills" ]]; then
    # Legacy fallback: walk skills/* directly.
    warn "catalog/skills.json missing; walking skills/ directly"
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
fi

# ---------------------------------------------------- Phase 9: Claude Code env + permissions
log "Phase 9 — Claude Code Ollama Cloud wiring + permissions"
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR"
# Write or update env vars + merge permissions.allow in ~/.claude/settings.json.
# We only touch keys we own; don't clobber MCPs registered above.
# The permissions block lets agent-driven `clawteam launch ...` (via the skill)
# run without interactive approval prompts — critical for Path B to work.
python3 - <<PY
import json, os, pathlib
p = pathlib.Path(os.path.expanduser("~/.claude/settings.json"))
data = {}
if p.exists():
    try:    data = json.loads(p.read_text())
    except Exception: data = {}

# --- env ---
data.setdefault("env", {})
data["env"].update({
    "ANTHROPIC_AUTH_TOKEN": "ollama",
    "ANTHROPIC_API_KEY":   "",
    "ANTHROPIC_BASE_URL":  "${GENESIS_OLLAMA_HOST}",
})

# --- permissions.allow (merge, preserve user additions) ---
genesis_allow = [
    "Read",
    "Bash(clawteam *)",
    "Bash(tmux *)",
    "Bash(git status)",
    "Bash(git diff *)",
    "Bash(git log *)",
    "Bash(git branch *)",
    "Bash(ls *)",
]
perms = data.setdefault("permissions", {})
existing = perms.get("allow", []) or []
seen = set(existing)
for entry in genesis_allow:
    if entry not in seen:
        existing.append(entry)
        seen.add(entry)
perms["allow"] = existing

p.write_text(json.dumps(data, indent=2))
print(f"wrote {p}")
PY

# ---------------------------------------------------- Phase 10: agent files + clawteam templates
log "Phase 10 — agent prompts and clawteam templates"
mkdir -p "$HOME/.claude/agents" "$HOME/.clawteam/templates"

CAT_AGENTS="$GENESIS_HOME/catalog/agents.json"
if [[ -f "$CAT_AGENTS" ]]; then
  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    name=$(echo "$item"    | jq -r '.name')
    source=$(echo "$item"  | jq -r '.source')
    dest=$(echo "$item"    | jq -r '.install_to // ""')
    src="$GENESIS_HOME/$source"
    dst=$(expand_home "${dest:-$HOME/.claude/agents/$(basename "$source")}")
    if [[ -f "$src" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp -f "$src" "$dst"
      step "agent: $name"
    else
      warn "agent '$name' source missing: $src"
    fi
  done < <(catalog_enabled_items "$CAT_AGENTS")
elif [[ -d "$GENESIS_HOME/agents" ]]; then
  warn "catalog/agents.json missing; copying agents/*.md directly"
  cp -f "$GENESIS_HOME"/agents/*.md "$HOME/.claude/agents/" 2>/dev/null || true
fi

# clawteam team templates. Entries flagged "upstream": true are already
# bundled with the clawteam pipx install and have no source file of their
# own - we just log them for visibility in the summary.
CAT_TEMPLATES="$GENESIS_HOME/catalog/templates.json"
if [[ -f "$CAT_TEMPLATES" ]]; then
  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    name=$(echo "$item"     | jq -r '.name')
    upstream=$(echo "$item" | jq -r '.upstream // false')
    if [[ "$upstream" == "true" ]]; then
      step "template: $name (upstream - bundled with clawteam)"
      continue
    fi
    source=$(echo "$item"  | jq -r '.source // ""')
    dest=$(echo "$item"    | jq -r '.install_to // ""')
    if [[ -z "$source" ]]; then
      warn "template '$name' has no source and no upstream flag; skipping"
      continue
    fi
    src="$GENESIS_HOME/$source"
    dst=$(expand_home "${dest:-$HOME/.clawteam/templates/$(basename "$source")}")
    if [[ -f "$src" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp -f "$src" "$dst"
      step "template: $name"
    else
      warn "template '$name' source missing: $src"
    fi
  done < <(catalog_enabled_items "$CAT_TEMPLATES")
fi

# ---------------------------------------------------- Phase 10b: VM-first workspace
if [[ "$GENESIS_VM_MODE" == "1" ]]; then
  log "Phase 10b — VM-first workspace"
  mkdir -p "$HOME/projects"
  step "created $HOME/projects (primary workspace for VM-first)"
  # Friendly hint file so `ls ~` is self-explanatory.
  if [[ ! -f "$HOME/projects/README.md" ]]; then
    cat > "$HOME/projects/README.md" << 'EOF'
# ~/projects — your workspace

This directory lives on the VM's native ext4 disk — fast I/O, isolated from
Windows. Clone or `git init` new work here (not under /vagrant which is
read-only, and not under /home/vagrant/shared-projects unless you opted in
via GENESIS_SYNC_PROJECTS).

Example:
  cd ~/projects
  git clone git@github.com:you/my-app.git
  cd my-app
  clawteam launch genesis-coder --goal "..." --workspace --repo .

Your host's ssh-agent is forwarded (see Vagrantfile ssh.forward_agent),
so `git push` works without copying keys or PATs into the VM.
EOF
  fi
fi

# ---------------------------------------------------- Phase 11: summary
log "Summary"
printf '  claude:    %s\n'  "$(command -v claude   || echo 'MISSING')"
printf '  openclaw:  %s\n'  "$(command -v openclaw || echo 'skipped')"
printf '  clawteam:  %s\n'  "$(command -v clawteam || echo 'skipped')"
printf '  uv:        %s\n'  "$(command -v uv       || echo 'MISSING')"
printf '  node:      %s\n'  "$(node -v 2>/dev/null || echo 'MISSING')"
printf '  ollama @:  %s\n'  "$GENESIS_OLLAMA_HOST"
printf '  skills:    %s under ~/.claude/skills\n' "$(find "$HOME/.claude/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
printf '  agents:    %s under ~/.claude/agents\n' "$(find "$HOME/.claude/agents" -mindepth 1 -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l)"
printf '  templates: %s under ~/.clawteam/templates\n' "$(find "$HOME/.clawteam/templates" -mindepth 1 -maxdepth 1 -type f -name '*.toml' 2>/dev/null | wc -l)"
printf '  gateway:   %s\n' "$GENESIS_GATEWAY_STATUS"
log "Done. Next: 'ollama signin' on the Windows host (if not already), then 'claude mcp list' to verify."
if [[ "$GENESIS_GATEWAY_STATUS" == "active" ]]; then
  log "Gateway daemon is running. To pair Telegram, see docs/openclaw-daemon.md."
fi
