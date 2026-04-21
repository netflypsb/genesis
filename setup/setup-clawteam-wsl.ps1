#Requires -Version 5.1
# ---------------------------------------------------------------------------
# DEPRECATED (2026-04) - kept for backwards compatibility only.
#
# This was the v3.0 WSL-only provider+setup wizard. It has been replaced by:
#
#   setup\setup-genesis.ps1    - full install (WSL default, -VMFirst for VM)
#   setup\setup-provider.ps1   - provider/model picker (backend-agnostic)
#
# The new provider wizard:
#   - Works for BOTH WSL and VM backends (auto-detects)
#   - Fetches model lists dynamically from provider APIs
#   - Preserves existing MCPs / skills / permissions in settings.json
#
# Migrate:
#   .\setup\setup-genesis.ps1          # one-time install
#   .\setup\setup-provider.ps1         # change provider / models any time
# ---------------------------------------------------------------------------
# Genesis - ClawTeam + Claude Code WSL Setup Wizard v3.0 (legacy)
# Runs from Windows PowerShell, configures everything inside WSL Ubuntu.

param(
    [switch]$NonInteractive,
    [string]$ConfigFile = ""
)

Write-Host ""
Write-Host "  ! setup-clawteam-wsl.ps1 is DEPRECATED." -ForegroundColor Yellow
Write-Host "  Use setup-genesis.ps1 + setup-provider.ps1 instead." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Continuing with legacy wizard in 5s (Ctrl+C to abort)..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# -- Locate repo root ----------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

# Dot-source shared libs
. (Join-Path $ScriptDir "lib\common.ps1")
. (Join-Path $ScriptDir "lib\wsl.ps1")
. (Join-Path $ScriptDir "lib\mcp.ps1")

# =============================================================================
#  CONSTANTS
# =============================================================================
$PROVIDERS = [ordered]@{
    "OllamaCloud" = @{
        # Default. Uses the local Ollama desktop app which proxies :cloud models.
        baseUrlFn     = { Get-WslHostForOllama }   # resolved at runtime
        authToken     = "ollama"
        needsKey      = $false
        keyLabel      = ""
        keyHint       = "No API key needed. Requires the Windows Ollama desktop app running and signed in."
        modelHint     = "kimi-k2.5:cloud"
        modelExamples = @("kimi-k2.5:cloud","glm-5:cloud","minimax-m2.7:cloud","qwen3.5:cloud","gpt-oss:120b-cloud")
    }
    "OpenRouter"  = @{
        baseUrlFn     = { "https://openrouter.ai/api" }
        authToken     = ""
        needsKey      = $true
        keyLabel      = "OpenRouter API key (starts with sk-or-)"
        keyHint       = "Get yours at https://openrouter.ai/keys"
        modelHint     = "anthropic/claude-sonnet-4-6"
        modelExamples = @("anthropic/claude-sonnet-4-6","google/gemini-2.5-pro","minimax/minimax-m2","moonshotai/kimi-k2","meta-llama/llama-3.3-70b-instruct:free")
    }
    "Anthropic"   = @{
        baseUrlFn     = { "" }
        authToken     = ""
        needsKey      = $true
        keyLabel      = "Anthropic API key"
        keyHint       = "Get yours at https://console.anthropic.com/keys"
        modelHint     = "claude-sonnet-4-6"
        modelExamples = @("claude-sonnet-4-6","claude-opus-4-6","claude-haiku-4-5-20251001")
    }
    "OllamaLocal" = @{
        baseUrlFn     = { Get-WslHostForOllama }
        authToken     = "ollama"
        needsKey      = $false
        keyLabel      = ""
        keyHint       = "No key needed. Pull a model first inside WSL: ollama pull qwen2.5-coder:7b"
        modelHint     = "qwen2.5-coder:7b"
        modelExamples = @("qwen2.5-coder:7b","qwen2.5-coder:14b","deepseek-coder-v2","llama3.3")
    }
    "MiniMax"     = @{
        baseUrlFn     = { "" }
        authToken     = ""
        needsKey      = $true
        keyLabel      = "MiniMax API key"
        keyHint       = "Get yours at https://platform.minimaxi.com"
        modelHint     = "MiniMax-Text-01"
        modelExamples = @("MiniMax-Text-01","minimax-m2.7:cloud","abab6.5s-chat")
    }
}

$AGENT_TYPES  = @("claude","codex","openclaw","nanobot","kimi","custom")
$AGENT_LABELS = @(
    "Claude Code  -- claude CLI (recommended, works with any provider)",
    "OpenAI Codex -- codex CLI (requires OpenAI API key)",
    "OpenClaw     -- openclaw CLI",
    "nanobot      -- nanobot CLI (github.com/HKUDS/nanobot)",
    "Kimi CLI     -- kimi CLI (MoonshotAI)",
    "Custom CLI   -- any agent that accepts a task prompt"
)

# =============================================================================
#  BANNER
# =============================================================================
Clear-Host
Write-Host ""
Write-Host "  +------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |   Genesis - ClawTeam + Claude Code  v3.0             |" -ForegroundColor Cyan
Write-Host "  |   Agent swarm on WSL with global MCP servers         |" -ForegroundColor Cyan
Write-Host "  +------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Info "Repo root: $RepoRoot"
Write-Info "Phases:"
Write-Info "  [0] Self-check      -- PowerShell, WSL, networking mode"
Write-Info "  [1] Requirements    -- scan WSL for python/node/uv/claude/clawteam/tmux"
Write-Info "  [2] Install missing -- apt + NodeSource + uv + npm + pip + playwright"
Write-Info "  [3] Provider config -- default: Ollama Cloud (no key)"
Write-Info "  [4] MCP servers     -- install playwright/fetch/git globally"
Write-Info "  [5] Agent team      -- copy planner/builder/reviewer/scribe agents"
Write-Info "  [6] Team launch     -- pick leader/worker, optional starter team"
Write-Info "  [7] Verify          -- claude mcp list, clawteam ping, summary"
Write-Host ""

# =============================================================================
#  PHASE 0 -- SELF-CHECK
# =============================================================================
Write-Header "Phase 0 of 7 -- Self-Check"

Write-Check "PowerShell $($PSVersionTable.PSVersion)" ($PSVersionTable.PSVersion.Major -ge 5)

if (-not (Test-WslAvailable)) {
    Write-Fail "WSL not found. Install with: wsl --install"
    exit 1
}
Write-Check "WSL available" $true

# Pick a real distro (skip docker-desktop*)
try {
    $chosenDistro = Select-WslDistro
    Write-Check "WSL distro selected" $true $chosenDistro
} catch {
    Write-Fail $_.Exception.Message
    Write-Info "  Installed distros:"
    Get-WslDistroList | ForEach-Object { Write-Info "    - $_" }
    exit 1
}

$netMode = Get-WslNetworkingMode
Write-Check "WSL networking mode" ($netMode -ne 'unknown') $netMode

if ($netMode -ne 'mirrored') {
    Write-Warn "Mirrored networking is not enabled."
    Write-Info "  With mirrored mode, the Windows Ollama app is reachable from WSL as localhost:11434."
    Write-Info "  Without it, Genesis will use host.docker.internal:11434 (also works)."
    $doMirror = Read-YesNo "Enable mirrored networking in %UserProfile%\.wslconfig now?" $true
    if ($doMirror) {
        Enable-WslMirroredNetworking | Out-Null
        Write-Ok "Wrote networkingMode=mirrored to $env:USERPROFILE\.wslconfig"
        Write-Warn "A 'wsl --shutdown' is required for this to take effect."
        $doShutdown = Read-YesNo "Run 'wsl --shutdown' now? (WSL will restart on next use)" $true
        if ($doShutdown) {
            wsl --shutdown
            Start-Sleep -Seconds 2
            Write-Ok "WSL shut down. It will restart on the next wsl call."
        } else {
            Write-Warn "Skipped. Genesis will use host.docker.internal for this session."
        }
    }
}

# Distro info
$distroInfo = (Invoke-WslCmd "lsb_release -d 2>/dev/null | cut -f2") | Out-String
if ([string]::IsNullOrWhiteSpace($distroInfo)) { $distroInfo = "Linux" }
Write-Check "WSL distro" $true $distroInfo.Trim()

# =============================================================================
#  PHASE 1 -- REQUIREMENTS SCAN
# =============================================================================
Write-Header "Phase 1 of 7 -- Requirements Scan"

$checks = [ordered]@{
    "python3"  = @{ cmd="python3"; vFlag="--version"; minMatch="Python 3\.(1[0-9]|[2-9]\d)"; label="Python 3.10+" }
    "pip"      = @{ cmd="pip3";    vFlag="--version"; minMatch=".";                           label="pip3" }
    "tmux"     = @{ cmd="tmux";    vFlag="-V";        minMatch=".";                           label="tmux" }
    "git"      = @{ cmd="git";     vFlag="--version"; minMatch=".";                           label="git" }
    "node"     = @{ cmd="node";    vFlag="--version"; minMatch="v(2[0-9]|[3-9]\d)\.";        label="Node.js 20+" }
    "uv"       = @{ cmd="uv";      vFlag="--version"; minMatch=".";                           label="uv (Astral)" }
    "claude"   = @{ cmd="claude";  vFlag="--version"; minMatch=".";                           label="Claude Code" }
    "clawteam" = @{ cmd="";        vFlag="";          minMatch=".";                           label="ClawTeam" }
}

$missing = @()
foreach ($key in $checks.Keys) {
    $c = $checks[$key]
    if ($key -eq "clawteam") {
        $ctOut = (Invoke-WslCmd "python3 -m clawteam --version 2>/dev/null") | Out-String
        $ok = $ctOut -match "\d"
        Write-Check $c.label $ok $(if ($ok) { $ctOut.Trim() } else { "not found" })
        if (-not $ok) { $missing += $key }
        continue
    }
    $exists = Test-WslCommand $c.cmd
    if ($exists) {
        $ver = Get-WslVersion $c.cmd $c.vFlag
        $ok  = $ver -match $c.minMatch
        Write-Check $c.label $ok $ver
        if (-not $ok) { $missing += $key }
    } else {
        Write-Check $c.label $false "not found"
        $missing += $key
    }
}

Write-Host ""
if ($missing.Count -eq 0) {
    Write-Ok "All requirements satisfied."
} else {
    Write-Warn "Missing or outdated: $($missing -join ', ')"
}

# =============================================================================
#  PHASE 2 -- INSTALL MISSING
# =============================================================================
Write-Header "Phase 2 of 7 -- Install Missing Requirements"

if ($missing.Count -eq 0) {
    Write-Info "Nothing to install."
} else {
    $aptPkgs     = @()
    $needNode    = $false
    $needUv      = $false
    $needClaude  = $false
    $needCt      = $false

    foreach ($m in $missing) {
        switch ($m) {
            "python3"  { Write-Info "  - Python 3      (sudo apt install python3)";              $aptPkgs += "python3" }
            "pip"      { Write-Info "  - pip3          (sudo apt install python3-pip)";          $aptPkgs += "python3-pip" }
            "tmux"     { Write-Info "  - tmux          (sudo apt install tmux)";                 $aptPkgs += "tmux" }
            "git"      { Write-Info "  - git           (sudo apt install git)";                  $aptPkgs += "git" }
            "node"     { Write-Info "  - Node.js 20    (NodeSource script)";                     $needNode = $true }
            "uv"       { Write-Info "  - uv (Astral)   (https://astral.sh/uv/install.sh)";       $needUv = $true }
            "claude"   { Write-Info "  - Claude Code   (npm install -g @anthropic-ai/claude-code)"; $needClaude = $true }
            "clawteam" { Write-Info "  - ClawTeam      (pip3 install clawteam)";                 $needCt = $true }
        }
    }

    Write-Host ""
    $doInstall = Read-YesNo "Proceed with installation?" $true
    if (-not $doInstall) {
        Write-Warn "Installation skipped. Some features will not work."
    } else {
        if ($aptPkgs.Count -gt 0) {
            $pkgStr = $aptPkgs -join " "
            Write-Step "Installing apt packages: $pkgStr"
            Invoke-WslLogin "sudo apt-get update -qq && sudo apt-get install -y $pkgStr" | ForEach-Object { Write-Info "  $_" }
        }
        if ($needNode) {
            Write-Step "Installing Node.js 20 via NodeSource..."
            Invoke-WslLogin "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" | ForEach-Object { Write-Info "  $_" }
        }
        if ($needUv) {
            Write-Step "Installing uv (Astral)..."
            Invoke-WslLogin "curl -LsSf https://astral.sh/uv/install.sh | sh" | ForEach-Object { Write-Info "  $_" }
            Invoke-WslLogin "grep -q '.local/bin' ~/.bashrc || echo 'export PATH=`$HOME/.local/bin:`$PATH' >> ~/.bashrc" | Out-Null
        }
        if ($needClaude) {
            Write-Step "Installing Claude Code..."
            Invoke-WslLogin "sudo npm install -g @anthropic-ai/claude-code" | ForEach-Object { Write-Info "  $_" }
        }
        if ($needCt) {
            Write-Step "Installing ClawTeam..."
            Invoke-WslLogin "pip3 install --user clawteam" | ForEach-Object { Write-Info "  $_" }
            Invoke-WslLogin @'
mkdir -p ~/.local/bin
grep -q 'local/bin' ~/.bashrc || echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
if ! command -v clawteam >/dev/null 2>&1; then
  printf '#!/bin/bash\npython3 -m clawteam "$@"\n' > ~/.local/bin/clawteam
  chmod +x ~/.local/bin/clawteam
fi
'@ | Out-Null
        }

        Write-Ok "Installation pass complete. (Re-open WSL if any PATH changes are needed.)"
    }
}

# =============================================================================
#  PHASE 3 -- PROVIDER CONFIG
# =============================================================================
Write-Header "Phase 3 of 7 -- AI Provider Configuration"
Write-Info "Writes ~/.claude/settings.json inside WSL. Every Claude agent (including"
Write-Info "those spawned by ClawTeam) reads this file on launch."
Write-Host ""

$existingJson = Read-WslFile "~/.claude/settings.json"
$hasExisting  = (-not [string]::IsNullOrWhiteSpace($existingJson)) -and ($existingJson -notmatch "No such file")

$existingSettings = @{}
if ($hasExisting) {
    try { $existingSettings = ConvertTo-Hashtable ($existingJson | ConvertFrom-Json) } catch { $existingSettings = @{} }
    Write-Info "Existing WSL ~/.claude/settings.json found."
    $keep = Read-YesNo "Keep existing env + provider config (just merge MCP/agents later)?" $false
} else { $keep = $false }

$envBlock = @{}
$providerName = "existing"

if (-not $keep) {
    $providerNames = @($PROVIDERS.Keys)
    $providerDescs = @(
        "Ollama Cloud - NO API KEY. Needs Windows Ollama app running and signed in. (DEFAULT)",
        "OpenRouter   - 300+ models via one key. Free tier available.",
        "Anthropic    - Official Anthropic API. Best quality. Paid.",
        "Ollama Local - Your own hardware. Fully private. Free.",
        "MiniMax      - MiniMax global endpoint."
    )
    $pIdx = Read-Choice "Select AI provider" $providerDescs 0
    $providerName = $providerNames[$pIdx]
    $provider     = $PROVIDERS[$providerName]

    Write-Ok "Selected: $providerName"
    Write-Info "  $($provider.keyHint)"

    $baseUrlValue   = (& $provider.baseUrlFn)
    $authTokenValue = $provider.authToken
    $apiKeyValue    = ""

    if ($provider.needsKey) {
        $inputKey = Read-Text $provider.keyLabel -Required -Secret
        if ($providerName -in @("OpenRouter")) { $authTokenValue = $inputKey }
        else                                   { $apiKeyValue    = $inputKey }
    }

    Write-Host ""
    Write-Info "Recommended models for ${providerName}:"
    foreach ($ex in $provider.modelExamples) { Write-Info "    * $ex" }
    Write-Host ""
    $leaderModel = Read-Text "Lead agent model   (orchestration / complex tasks)" $provider.modelHint
    $workerModel = Read-Text "Worker agent model (sub-tasks / execution)        " $provider.modelHint

    if ($baseUrlValue)   { $envBlock["ANTHROPIC_BASE_URL"]   = $baseUrlValue }
    if ($authTokenValue) { $envBlock["ANTHROPIC_AUTH_TOKEN"] = $authTokenValue }
    $envBlock["ANTHROPIC_API_KEY"]                        = $apiKeyValue
    $envBlock["ANTHROPIC_DEFAULT_SONNET_MODEL"]           = $leaderModel
    $envBlock["ANTHROPIC_MODEL"]                          = $leaderModel
    $envBlock["ANTHROPIC_DEFAULT_HAIKU_MODEL"]            = $workerModel
    $envBlock["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
}

# =============================================================================
#  PHASE 4 -- MCP SERVERS
# =============================================================================
Write-Header "Phase 4 of 7 -- MCP Server Installation"
Write-Info "MCP servers are written into ~/.claude/settings.json in WSL and are"
Write-Info "inherited by every Claude agent -- including those ClawTeam spawns."
Write-Host ""

$registryPath = Join-Path $RepoRoot "mcp\registry.json"
$registry = (Get-McpRegistry $registryPath).servers
$defaultIds = @($registry.Keys | Where-Object { $registry[$_].default -eq $true })

Write-Info "Default MCP servers from registry: $($defaultIds -join ', ')"
$installDefaults = Read-YesNo "Install all defaults now?" $true
$selectedMcp = @()
if ($installDefaults) { $selectedMcp = $defaultIds }

# Offer extras
foreach ($id in $registry.Keys) {
    if ($selectedMcp -contains $id) { continue }
    $entry = $registry[$id]
    if (Read-YesNo "Also install optional MCP '$id' ($($entry.label))?" $false) { $selectedMcp += $id }
}

# Run post-install commands (e.g. playwright chromium)
foreach ($id in $selectedMcp) {
    $entry = $registry[$id]
    $req = Test-McpRequirements $entry.requires
    if (-not $req.ok) {
        Write-Warn "MCP '$id' needs: $($req.missing -join ', ') -- skipping. Install them and re-run."
        $selectedMcp = $selectedMcp | Where-Object { $_ -ne $id }
        continue
    }
    if ($entry.ContainsKey('post') -and $entry.post) {
        Invoke-McpPostInstall $entry.post
    }
    Write-Ok "MCP '$id' ready."
}

$mcpBlock = Build-McpServersBlock $registry $selectedMcp

# =============================================================================
#  WRITE SETTINGS.JSON
# =============================================================================
Write-Header "Writing ~/.claude/settings.json"

$settings = @{}
if ($hasExisting) { $settings = $existingSettings }

if (-not $keep) {
    $settings = Merge-Hashtable $settings @{
        env                = $envBlock
        autoUpdatesChannel = "latest"
        permissions        = @{
            allow = @("Read","Write","Edit","Bash","Glob","Grep","Bash(git *)","Bash(clawteam *)")
        }
    }
}
if ($mcpBlock.Count -gt 0) {
    if (-not $settings.ContainsKey('mcpServers')) { $settings['mcpServers'] = @{} }
    $settings['mcpServers'] = Merge-Hashtable (ConvertTo-Hashtable $settings['mcpServers']) $mcpBlock
}

$json = $settings | ConvertTo-Json -Depth 10
# Back up existing, then write
if ($hasExisting) {
    Invoke-WslCmd "cp ~/.claude/settings.json ~/.claude/settings.json.bak" | Out-Null
    Write-Info "Backed up previous settings to ~/.claude/settings.json.bak"
}
Write-WslFile "~/.claude/settings.json" $json
Write-Ok "Settings written."

# =============================================================================
#  PHASE 5 -- AGENT TEAM FILES
# =============================================================================
Write-Header "Phase 5 of 7 -- Agent Team Files"

$agentsSrc = Join-Path $RepoRoot "agents"
if (Test-Path $agentsSrc) {
    $installAgents = Read-YesNo "Copy planner/builder/reviewer/scribe agents into WSL ~/.claude/agents/?" $true
    if ($installAgents) {
        Invoke-WslCmd "mkdir -p ~/.claude/agents" | Out-Null
        foreach ($f in Get-ChildItem $agentsSrc -Filter *.md) {
            $content = Get-Content $f.FullName -Raw
            Write-WslFile "~/.claude/agents/$($f.Name)" $content
            Write-Ok "Installed agent: $($f.Name)"
        }
    }
} else {
    Write-Warn "agents/ directory not found at $agentsSrc -- skipping."
}

# =============================================================================
#  PHASE 6 -- TEAM LAUNCH
# =============================================================================
Write-Header "Phase 6 of 7 -- Agent Orchestration and Team Launch"

Write-Host "  -- LEADER AGENT --" -ForegroundColor White
$leaderIdx = Read-Choice "Leader agent type" $AGENT_LABELS 0
$leaderCmd = $AGENT_TYPES[$leaderIdx]
if ($leaderCmd -eq "custom") { $leaderCmd = Read-Text "Leader CLI command" -Required }
Write-Ok "Leader: $leaderCmd"

Write-Host ""
Write-Host "  -- WORKER AGENTS --" -ForegroundColor White
$workerIdx = Read-Choice "Worker agent type" $AGENT_LABELS 0
$workerCmd = $AGENT_TYPES[$workerIdx]
if ($workerCmd -eq "custom") { $workerCmd = Read-Text "Worker CLI command" -Required }
Write-Ok "Worker: $workerCmd"

Write-Host ""
$backendIdx = Read-Choice "Spawn backend" @(
    "tmux       -- tiled terminal, watch all agents live (recommended)",
    "subprocess -- non-interactive, scripted agents"
) 0
$backend = if ($backendIdx -eq 0) { "tmux" } else { "subprocess" }
Write-Ok "Backend: $backend"

# List templates
Write-Step "Available ClawTeam templates:"
Invoke-WslCmd "python3 -m clawteam template list 2>&1" | ForEach-Object { Write-Info "  $_" }

Write-Host ""
$teamChoice = Read-Choice "Create a team now?" @(
    "Custom team   -- describe your own goal",
    "Template team -- use a built-in ClawTeam template",
    "Skip          -- create teams manually later"
) 2

if ($teamChoice -eq 0) {
    $teamName = Read-Text "Team name (lowercase, hyphens only)" "genesis-team"
    $teamGoal = Read-Text "Team goal" -Required
    $numWorkers = Read-Text "Number of worker agents" "3"

    if (Read-YesNo "Spawn team now?" $true) {
        Write-Step "Creating team: $teamName"
        Invoke-WslCmd "python3 -m clawteam team spawn-team $teamName -d '$teamGoal' 2>&1" | ForEach-Object { Write-Info "  $_" }
        $leaderTask = "$teamGoal -- split work across $numWorkers workers using: python3 -m clawteam spawn $backend $workerCmd --team $teamName --agent-name workerN --task 'subtask'"
        $spArgs = @(); $spArgs += (Get-WslDistroArgsString); $spArgs += @('--','bash','--login','-c',"python3 -m clawteam spawn $backend $leaderCmd --team $teamName --agent-name leader --task '$leaderTask'; exec bash")
        Start-Process wsl -ArgumentList $spArgs
        Write-Ok "Leader launched in new WSL window."
    }
} elseif ($teamChoice -eq 1) {
    $tmplName = Read-Text "Template name (from list above)" -Required
    $teamName = Read-Text "Team name" "team1"
    $teamGoal = Read-Text "Team goal" -Required
    if (Read-YesNo "Spawn team now?" $true) {
        Invoke-WslCmd "python3 -m clawteam template use $tmplName --team $teamName --goal '$teamGoal' 2>&1" | ForEach-Object { Write-Info "  $_" }
    }
}

# =============================================================================
#  PHASE 7 -- VERIFY
# =============================================================================
Write-Header "Phase 7 of 7 -- Verification"

Write-Step "claude --version"
Invoke-WslCmd "claude --version 2>&1" | ForEach-Object { Write-Info "  $_" }

Write-Step "claude mcp list"
Invoke-WslCmd "claude mcp list 2>&1" | ForEach-Object { Write-Info "  $_" }

Write-Step "clawteam team list"
Invoke-WslCmd "python3 -m clawteam team list 2>&1" | ForEach-Object { Write-Info "  $_" }

# =============================================================================
#  DONE
# =============================================================================
Write-Host ""
Write-Host "  +------------------------------------------------------+" -ForegroundColor Green
Write-Host "  |   Genesis Setup Complete!                            |" -ForegroundColor Green
Write-Host "  +------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Info "  Settings : ~/.claude/settings.json  (inside WSL)"
Write-Info "  Agents   : ~/.claude/agents/         (inside WSL)"
Write-Info "  MCP      : $($selectedMcp -join ', ')"
Write-Host ""
Write-Host "  Quick-start (run inside WSL):" -ForegroundColor White
Write-Host "    python3 -m clawteam team spawn-team my-team -d 'goal'" -ForegroundColor White
Write-Host "    python3 -m clawteam spawn $backend $leaderCmd --team my-team --agent-name leader --task 'goal'" -ForegroundColor White
Write-Host "    python3 -m clawteam board attach my-team" -ForegroundColor White
Write-Host ""
$openWsl = Read-YesNo "Open a WSL terminal now?" $true
if ($openWsl) {
    $openArgs = Get-WslDistroArgsString
    if ($openArgs) { Start-Process wsl -ArgumentList $openArgs } else { Start-Process wsl }
}
