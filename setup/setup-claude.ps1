#Requires -Version 5.1
# Claude Code Setup Wizard v1.1
# Supports: Anthropic, OpenRouter, Ollama Cloud, Ollama Local
# Writes permanently to ~/.claude/settings.json - no shell profile needed

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# -- Colours -------------------------------------------------------------------
function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "  $('=' * $Text.Length)" -ForegroundColor DarkCyan
}
function Write-Step { param([string]$T); Write-Host ""; Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok   { param([string]$T); Write-Host "  OK  $T" -ForegroundColor Green }
function Write-Info { param([string]$T); Write-Host "  $T" -ForegroundColor Gray }
function Write-Warn { param([string]$T); Write-Host "  !! $T" -ForegroundColor DarkYellow }

# -- Input helpers -------------------------------------------------------------
function Read-Choice {
    param([string]$Prompt, [string[]]$Options, [int]$Default = 0)
    Write-Host ""
    for ($i = 0; $i -lt $Options.Count; $i++) {
        $marker = if ($i -eq $Default) { ">" } else { " " }
        $color  = if ($i -eq $Default) { "White" } else { "Gray" }
        Write-Host "  $marker [$($i+1)] $($Options[$i])" -ForegroundColor $color
    }
    Write-Host ""
    while ($true) {
        $raw = Read-Host "  $Prompt [1-$($Options.Count), Enter=$($Default+1)]"
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        if ($raw -match '^\d+$') {
            $n = [int]$raw - 1
            if ($n -ge 0 -and $n -lt $Options.Count) { return $n }
        }
        Write-Warn "Enter a number between 1 and $($Options.Count)"
    }
}

function Read-Text {
    param([string]$Prompt, [string]$Default = "", [switch]$Required, [switch]$Secret)
    $hint = if ($Default) { " [default: $Default]" } else { "" }
    while ($true) {
        Write-Host "  $Prompt$hint" -ForegroundColor White -NoNewline
        Write-Host ": " -NoNewline
        if ($Secret) {
            $secure = Read-Host -AsSecureString
            $val = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        } else {
            $val = Read-Host
        }
        if ([string]::IsNullOrWhiteSpace($val)) {
            if ($Default)  { return $Default }
            if ($Required) { Write-Warn "This field is required."; continue }
            return ""
        }
        return $val.Trim()
    }
}

function Read-YesNo {
    param([string]$Prompt, [bool]$Default = $true)
    $hint = if ($Default) { "Y/n" } else { "y/N" }
    while ($true) {
        $raw = Read-Host "  $Prompt [$hint]"
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        if ($raw -match '^[Yy]') { return $true }
        if ($raw -match '^[Nn]') { return $false }
        Write-Warn "Please enter Y or N"
    }
}

# -- Settings helpers ----------------------------------------------------------
function Get-SettingsPath { Join-Path $env:USERPROFILE ".claude\settings.json" }
function Get-AgentsDir    { Join-Path $env:USERPROFILE ".claude\agents" }

function Read-Settings {
    $p = Get-SettingsPath
    if (Test-Path $p) {
        try { return Get-Content $p -Raw | ConvertFrom-Json } catch { }
    }
    return [PSCustomObject]@{}
}

function Save-Settings {
    param([hashtable]$Data)
    $path = Get-SettingsPath
    $dir  = Split-Path $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (Test-Path $path) {
        Copy-Item $path "$path.bak" -Force
        Write-Info "Previous settings backed up to $path.bak"
    }
    $Data | ConvertTo-Json -Depth 10 | Set-Content $path -Encoding UTF8
    Write-Ok "Settings written to $path"
}

function Merge-Settings {
    param([hashtable]$New)
    $existing = Read-Settings
    $merged = @{}
    if ($existing -is [PSCustomObject]) {
        $existing.PSObject.Properties | ForEach-Object { $merged[$_.Name] = $_.Value }
    }
    foreach ($k in $New.Keys) { $merged[$k] = $New[$k] }
    return $merged
}

function Write-AgentFile {
    param([string]$Name, [string]$Content)
    $dir = Get-AgentsDir
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $path = Join-Path $dir "$Name.md"
    [System.IO.File]::WriteAllText($path, $Content, [System.Text.Encoding]::UTF8)
    Write-Ok "Agent written: $path"
}

# -- Provider map --------------------------------------------------------------
$PROVIDERS = [ordered]@{
    "Anthropic"    = @{
        baseUrl       = ""
        authToken     = ""
        apiKey        = ""
        needsKey      = $true
        keyLabel      = "Anthropic API key"
        keyHint       = "Get yours at https://console.anthropic.com/keys"
        modelHint     = "claude-sonnet-4-6"
        modelExamples = @("claude-sonnet-4-6","claude-opus-4-6","claude-haiku-4-5-20251001")
    }
    "OpenRouter"   = @{
        baseUrl       = "https://openrouter.ai/api"
        authToken     = ""
        apiKey        = ""
        needsKey      = $true
        keyLabel      = "OpenRouter API key (starts with sk-or-)"
        keyHint       = "Get yours at https://openrouter.ai/keys"
        modelHint     = "minimax/minimax-m2"
        modelExamples = @("minimax/minimax-m2","anthropic/claude-sonnet-4-6","google/gemini-2.5-pro","meta-llama/llama-3.3-70b-instruct:free")
    }
    "OllamaCloud"  = @{
        baseUrl       = "http://localhost:11434"
        authToken     = "ollama"
        apiKey        = ""
        needsKey      = $false
        keyLabel      = ""
        keyHint       = "No API key needed. Ollama app must be running."
        modelHint     = "kimi-k2.5:cloud"
        modelExamples = @("kimi-k2.5:cloud","glm-5:cloud","minimax-m2.7:cloud","qwen3.5:cloud")
    }
    "OllamaLocal"  = @{
        baseUrl       = "http://localhost:11434"
        authToken     = "ollama"
        apiKey        = ""
        needsKey      = $false
        keyLabel      = ""
        keyHint       = "No API key needed. Pull a model first: ollama pull qwen2.5-coder:7b"
        modelHint     = "qwen2.5-coder:7b"
        modelExamples = @("qwen2.5-coder:7b","qwen2.5-coder:14b","deepseek-coder-v2","llama3.3")
    }
}

# -- Agent body builders (plain string arrays - no here-strings) ----------------
function New-AgentContent {
    param([string]$Name, [string]$Label, [string]$Tools, [string]$Color, [string[]]$BodyLines)
    $body = $BodyLines -join "`n"
    $nl   = "`n"
    return "---${nl}name: ${Name}${nl}description: ${Label}${nl}tools: ${Tools}${nl}model: inherit${nl}color: ${Color}${nl}---${nl}${nl}${body}${nl}"
}

function Get-PlannerContent {
    $body = @(
        "You are the Project Planner. Decompose tasks into phase files. Do NOT write code.",
        "",
        "PROCESS",
        "1. Read CLAUDE.md if it exists.",
        "2. Read relevant existing files for context.",
        "3. Break task into 3-6 phases. Each phase must:",
        "   * Be completable in ONE focused development session",
        "   * Have a single clear responsibility",
        "   * Produce a testable output",
        "4. Create .claude/plan/ directory if missing.",
        "5. Write .claude/plan/phase_1.md, phase_2.md, etc.",
        "6. Write .claude/plan/PLAN_STATUS.md",
        "",
        "PHASE FILE FORMAT (use exactly this structure):",
        "",
        "  # Phase N: [Short Title]",
        "  ## Goal",
        "  One sentence describing what this phase achieves.",
        "  ## Context",
        "  Only what is needed for THIS phase. Keep it short.",
        "  ## Tasks",
        "  * Task 1 (specific: file names, function names, exact behaviour)",
        "  * Task 2",
        "  ## Success Criteria",
        "  Concrete, testable verification steps.",
        "  ## Files To Touch",
        "  List every file that will be created or modified.",
        "  ## Do NOT",
        "  Explicit out-of-scope items for this phase.",
        "",
        "PLAN_STATUS.md FORMAT:",
        "",
        "  # Plan Status",
        "  ## Phases",
        "  * [ ] Phase 1: [title] -> .claude/plan/phase_1.md",
        "  ## Current Phase",
        "  None started.",
        "  ## Notes",
        "  [anything important for future agents]",
        "",
        "WHEN DONE: Tell the user how many phases were created and a one-line summary",
        "of each. Then say: Run @builder and tell it: implement phase 1 from .claude/plan/phase_1.md"
    )
    return New-AgentContent "planner" "Planner - breaks tasks into focused phase files" "Read, Write, Glob, Bash" "yellow" $body
}

function Get-BuilderContent {
    $body = @(
        "You are the Builder. Implement exactly ONE phase at a time.",
        "",
        "RULES",
        "Read ONLY the phase file you are given. Do not open other phase files.",
        "Do not implement anything not listed in the phase file.",
        "Do not refactor code outside this phase scope.",
        "If something is unclear, make a reasonable decision and note it.",
        "",
        "PROCESS",
        "1. Read the phase file you were given (e.g. .claude/plan/phase_1.md).",
        "2. Read files listed under Files To Touch.",
        "3. Read files mentioned in Context -- nothing more.",
        "4. Implement every task in the Tasks list.",
        "5. Verify against Success Criteria.",
        "6. Run relevant tests or checks if Bash is available.",
        "",
        "WHEN DONE: Tell the user what you implemented, any deviations from the plan,",
        "and whether all Success Criteria are met.",
        "Then say: Run @reviewer and tell it: review phase N from .claude/plan/phase_N.md",
        "",
        "HARD LIMITS",
        "Do NOT touch files not listed in Files To Touch.",
        "Do NOT implement tasks from other phases.",
        "Do NOT read PLAN_STATUS.md or other phase files."
    )
    return New-AgentContent "builder" "Builder - implements exactly one phase per fresh context" "Read, Write, Edit, Bash, Glob, Grep" "blue" $body
}

function Get-ReviewerContent {
    $body = @(
        "You are the Reviewer. Validate Builder output against the plan. Make NO code changes.",
        "",
        "PROCESS",
        "1. Read the phase file you were given.",
        "2. Run: git diff HEAD  to see what changed.",
        "3. Check each task in the Tasks checklist -- is it done-",
        "4. Check each Success Criterion -- is it met-",
        "5. Check Files To Touch -- were unintended files modified-",
        "6. Check Do NOT -- was anything out of scope done-",
        "",
        "OUTPUT FORMAT",
        "PASSED or FAILED",
        "Tasks completed: X/Y",
        "Criteria met: X/Y",
        "Issues (if any): [specific issue with file and line reference]",
        "Unintended changes (if any): [file modified outside scope]",
        "",
        "WHEN DONE",
        "If PASSED: say - Run @scribe and tell it: mark phase N complete in .claude/plan/PLAN_STATUS.md",
        "If FAILED: tell user exactly what to fix, then say - Re-run @builder to fix: [list issues]",
        "",
        "HARD LIMITS",
        "Do NOT edit any files.",
        "Do NOT approve a phase that fails its own Success Criteria."
    )
    return New-AgentContent "reviewer" "Reviewer - validates a phase against its plan, read-only" "Read, Bash, Glob, Grep" "green" $body
}

function Get-ScribeContent {
    $body = @(
        "You are the Scribe. Maintain plan status files. Make NO code changes.",
        "",
        "PROCESS",
        "1. Read .claude/plan/PLAN_STATUS.md.",
        "2. Read the phase file for the completed phase.",
        "3. Mark that phase [x] done in PLAN_STATUS.md.",
        "4. Update Current Phase to the next phase, or ALL PHASES COMPLETE if done.",
        "5. Add a brief note under Notes with date and what was completed.",
        "6. If CLAUDE.md exists, update it with current phase status.",
        "",
        "WHEN DONE: Tell the user which phase was marked complete and what comes next.",
        "If next phase exists: say - Run @builder and tell it: implement phase N+1 from .claude/plan/phase_N+1.md",
        "If all phases done: say - All phases complete. You may run /compact to clean up context."
    )
    return New-AgentContent "scribe" "Scribe - updates plan status after each phase passes" "Read, Write, Edit" "cyan" $body
}

# =============================================================================
#  MAIN WIZARD
# =============================================================================
Clear-Host
Write-Host ""
Write-Host "  +------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |    Claude Code Setup Wizard  v1.1        |" -ForegroundColor Cyan
Write-Host "  +------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
Write-Info "Writes permanently to ~/.claude/settings.json"
Write-Info "No shell profile edits needed. Survives restarts."
Write-Host ""

# Check Claude Code
Write-Step "Checking Claude Code installation..."
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCmd) {
    Write-Warn "Claude Code not found in PATH."
    $install = Read-YesNo "Install via winget now-" $true
    if ($install) {
        winget install Anthropic.ClaudeCode
        Write-Ok "Installed. Restart terminal after setup if needed."
    } else {
        Write-Info "Install manually: https://code.claude.com/docs/en/overview"
    }
} else {
    Write-Ok "Claude Code found: $($claudeCmd.Source)"
}

# Step 1: Provider
Write-Header "Step 1 of 4 -- Choose Your AI Provider"

$providerNames = @($PROVIDERS.Keys)
$providerDesc  = @(
    "Anthropic    - Official API. Best quality. Paid.",
    "OpenRouter   - 300+ models via one key. Free tier available.",
    "Ollama Cloud - Cloud models via local Ollama app. Free tier.",
    "Ollama Local - Your own hardware. Fully private. Free."
)

$providerIdx  = Read-Choice "Select provider" $providerDesc 1
$providerName = $providerNames[$providerIdx]
$provider     = $PROVIDERS[$providerName]

Write-Ok "Selected: $providerName"
Write-Info "  $($provider.keyHint)"

# Step 2: API Key
Write-Header "Step 2 of 4 -- API Key"

$apiKeyValue    = ""
$authTokenValue = $provider.authToken

if ($provider.needsKey) {
    Write-Info "  $($provider.keyHint)"
    $inputKey = Read-Text $provider.keyLabel -Required -Secret
    if ($providerName -eq "OpenRouter") {
        # OpenRouter: key goes into AUTH_TOKEN, API_KEY must be empty string
        $authTokenValue = $inputKey
        $apiKeyValue    = ""
    } else {
        # Anthropic: key goes into API_KEY
        $apiKeyValue = $inputKey
    }
} else {
    Write-Ok "No API key required for $providerName"
    if ($providerName -like "Ollama*") { Write-Info "  Make sure Ollama is running: ollama serve" }
}

# Step 3: Model
Write-Header "Step 3 of 4 -- Choose Your Model"

Write-Info "  Recommended models for ${providerName}:"
foreach ($ex in $provider.modelExamples) { Write-Info "    * $ex" }
Write-Host ""

$modelSonnet = Read-Text "Main model (complex tasks)" $provider.modelHint
$modelHaiku  = Read-Text "Fast model (quick tasks)  " $provider.modelHint

# Step 4: Options
Write-Header "Step 4 of 4 -- Additional Options"

$disableTraffic = Read-YesNo "Disable non-essential telemetry traffic-" $true
$autoUpdates    = Read-YesNo "Auto-updates on latest channel-" $true

# Build env block
$envBlock = [ordered]@{}
if ($provider.baseUrl)  { $envBlock["ANTHROPIC_BASE_URL"]   = $provider.baseUrl }
if ($authTokenValue)    { $envBlock["ANTHROPIC_AUTH_TOKEN"]  = $authTokenValue }
$envBlock["ANTHROPIC_API_KEY"] = $apiKeyValue
if ($modelSonnet) {
    $envBlock["ANTHROPIC_DEFAULT_SONNET_MODEL"] = $modelSonnet
    $envBlock["ANTHROPIC_MODEL"]                = $modelSonnet
}
if ($modelHaiku)     { $envBlock["ANTHROPIC_DEFAULT_HAIKU_MODEL"]  = $modelHaiku }
if ($disableTraffic) { $envBlock["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1" }

# Summary
Write-Header "Configuration Summary"
Write-Info "  Provider : $providerName"
Write-Info "  Model    : $modelSonnet"
foreach ($k in $envBlock.Keys) {
    $v = $envBlock[$k]
    $display = if ($k -match "TOKEN|KEY" -and $v.Length -gt 8) {
        "$($v.Substring(0,6))...$($v.Substring($v.Length-4))"
    } else { $v }
    Write-Info "  $k = $display"
}

Write-Host ""
$confirm = Read-YesNo "Write these settings to ~/.claude/settings.json-" $true
if (-not $confirm) { Write-Warn "Aborted. No changes made."; exit 0 }

$settings = Merge-Settings @{
    autoUpdatesChannel = if ($autoUpdates) { "latest" } else { "stable" }
    env                = $envBlock
    permissions        = @{
        allow = @("Read","Bash(git status)","Bash(git diff *)","Bash(ls *)")
    }
}

Save-Settings $settings
Write-Ok "Provider configuration complete!"

# =============================================================================
#  OPTIONAL: AGENT TEAMS
# =============================================================================
Write-Header "Optional -- Agent Team Setup"
Write-Info "Agent teams let specialised subagents handle planning, building,"
Write-Info "reviewing and status tracking, each in a fresh context window."
Write-Info "Ideal for complex tasks on less powerful models."
Write-Host ""

$setupAgents = Read-YesNo "Set up the phased-development agent team-" $true

if ($setupAgents) {
    Write-Host ""
    Write-Info "Four agents will be created:"
    Write-Info "  [1] planner  - breaks task into phase files"
    Write-Info "  [2] builder  - implements one phase at a time"
    Write-Info "  [3] reviewer - validates each phase (read-only)"
    Write-Info "  [4] scribe   - updates plan status after approval"
    Write-Host ""

    $installAll = Read-YesNo "Install all 4 agents (recommended)-" $true

    Write-Host ""
    Write-Step "Writing agent files to ~/.claude/agents/ ..."

    if ($installAll -or (Read-YesNo "Install planner-" $true))  { Write-AgentFile "planner"  (Get-PlannerContent)  }
    if ($installAll -or (Read-YesNo "Install builder-" $true))  { Write-AgentFile "builder"  (Get-BuilderContent)  }
    if ($installAll -or (Read-YesNo "Install reviewer-" $true)) { Write-AgentFile "reviewer" (Get-ReviewerContent) }
    if ($installAll -or (Read-YesNo "Install scribe-" $true))   { Write-AgentFile "scribe"   (Get-ScribeContent)   }

    # Custom agent
    Write-Host ""
    $addCustom = Read-YesNo "Add a custom agent-" $false
    while ($addCustom) {
        Write-Header "Custom Agent"
        $cName  = Read-Text "Agent name (lowercase, hyphens only)" -Required
        $cDesc  = Read-Text "Description (when should Claude use this-)" -Required
        $cColor = Read-Text "Color (red/blue/green/yellow/purple/orange/pink/cyan)" "purple"
        $cTools = Read-Text "Tools (comma-separated)" "Read, Write, Edit, Bash, Glob, Grep"
        $cModel = Read-Text "Model (inherit/sonnet/haiku/opus)" "inherit"
        Write-Info "Enter the agent system prompt. Type END on its own line when done."
        Write-Host ""
        $promptLines = @()
        while ($true) {
            $line = Read-Host "  "
            if ($line -eq "END") { break }
            $promptLines += $line
        }
        Write-AgentFile $cName (New-AgentContent $cName $cDesc $cTools $cColor $promptLines)
        Write-Host ""
        $addCustom = Read-YesNo "Add another custom agent-" $false
    }

    Write-Host ""
    Write-Ok "Agent team setup complete!"
    Write-Header "How to Use Your Agents"
    Write-Info ""
    Write-Info "  1. Describe your full task to: @planner"
    Write-Info "     It creates .claude/plan/phase_1.md, phase_2.md, etc."
    Write-Info ""
    Write-Info "  2. For each phase (run in order, one at a time):"
    Write-Info "     @builder   implement phase 1 from .claude/plan/phase_1.md"
    Write-Info "     @reviewer  review phase 1 from .claude/plan/phase_1.md"
    Write-Info "     @scribe    mark phase 1 complete in .claude/plan/PLAN_STATUS.md"
    Write-Info ""
    Write-Info "  3. Repeat step 2 for each phase."
    Write-Info "  4. Inside Claude Code, run /agents to see all your agents."
    Write-Host ""
}

# =============================================================================
#  DONE
# =============================================================================
Write-Host ""
Write-Host "  +------------------------------------------+" -ForegroundColor Green
Write-Host "  |         Setup Complete!                  |" -ForegroundColor Green
Write-Host "  +------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Info "  Settings : $env:USERPROFILE\.claude\settings.json"
Write-Info "  Agents   : $env:USERPROFILE\.claude\agents\"
Write-Host ""
Write-Host "  To start Claude Code  :  claude" -ForegroundColor White
Write-Host "  To re-run this wizard :  .\setup-claude.ps1" -ForegroundColor White
Write-Host ""

$launch = Read-YesNo "Launch Claude Code now-" $false
if ($launch) { & claude }