#Requires -Version 5.1
# ---------------------------------------------------------------------------
# Genesis - AI provider + model picker (backend-agnostic)
#
# Works for BOTH backends:
#   - WSL  (auto-detected via wsl.exe -l listing a non-docker distro)
#   - VM   (auto-detected via $env:USERPROFILE\.genesis\vm-config.json)
#
# Writes ~/.claude/settings.json inside the sandbox. Every Claude Code session
# (and every ClawTeam-spawned agent) picks up the new provider on next launch.
#
# Supported providers:
#   - OllamaCloud (no key; uses Windows Ollama daemon)
#   - OpenRouter  (dynamic model list via GET /api/v1/models)
#   - Anthropic   (dynamic model list via GET /v1/models, needs key)
#   - OllamaLocal (dynamic model list via `ollama list` inside sandbox)
#
# Usage:
#   .\setup\setup-provider.ps1                        # auto-detect backend
#   .\setup\setup-provider.ps1 -Backend vm            # force VM
#   .\setup\setup-provider.ps1 -Backend wsl           # force WSL
#   .\setup\setup-provider.ps1 -Provider openrouter   # skip prompt
# ---------------------------------------------------------------------------

param(
    [ValidateSet("auto","wsl","vm")]
    [string]$Backend = "auto",

    [ValidateSet("","ollama-cloud","openrouter","anthropic","ollama-local")]
    [string]$Provider = "",

    [string]$LeaderModel = "",
    [string]$WorkerModel = "",
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

. (Join-Path $ScriptDir "lib\common.ps1")

# ============================================================================
#  BACKEND DETECTION + ABSTRACTION
# ============================================================================
function Get-Backend {
    param([string]$Hint)
    if ($Hint -eq "wsl" -or $Hint -eq "vm") { return $Hint }

    $vmCfg = Join-Path $env:USERPROFILE ".genesis\vm-config.json"
    $hasVm = Test-Path $vmCfg

    $hasWsl = $false
    try {
        $distros = & wsl.exe -l -q 2>$null | Where-Object { $_ -and ($_ -notmatch "docker") }
        if ($distros) { $hasWsl = $true }
    } catch {}

    if ($hasVm -and -not $hasWsl)   { return "vm"  }
    if ($hasWsl -and -not $hasVm)   { return "wsl" }
    if ($hasVm -and $hasWsl) {
        $pick = Read-Choice "Both WSL and VM backends detected. Which to configure?" @(
            "VM  - Vagrant VM at ~/genesis",
            "WSL - Ubuntu WSL distro"
        ) 0
        return $(if ($pick -eq 0) { "vm" } else { "wsl" })
    }
    throw "No sandbox detected. Run setup-genesis.ps1 first."
}

# Dispatches a bash command to the detected sandbox and returns stdout.
function Invoke-SandboxCmd {
    param([string]$Cmd, [switch]$Quiet)
    if ($script:Backend -eq "vm") {
        $repo = Join-Path $env:USERPROFILE "genesis"
        if (-not (Test-Path (Join-Path $repo "Vagrantfile"))) {
            throw "Vagrantfile not found at $repo. Run setup-genesis.ps1 -VMFirst first."
        }
        Push-Location $repo
        try {
            $out = & vagrant ssh -c $Cmd 2>&1
            return $out
        } finally { Pop-Location }
    } else {
        $out = & wsl.exe -- bash -lc $Cmd 2>&1
        return $out
    }
}

# Writes $Content to $Path inside the sandbox.
# Uses base64 to carry the payload (no shell-metachar escaping needed), and
# splits mkdir+write into TWO ssh calls so neither command contains embedded
# double quotes (which PowerShell 5.1's native-arg splitter mangles when
# invoking `vagrant ssh -c "..."`).
function Write-SandboxFile {
    param([string]$Path, [string]$Content)

    # Derive parent dir on the PS side so we don't need a subshell on bash.
    $parent = ($Path -replace '/[^/]+$', '')
    if (-not $parent) { $parent = '/' }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Content)
    $b64   = [Convert]::ToBase64String($bytes)

    # Neither command contains double quotes => PowerShell passes each as a
    # single argument to the native exe cleanly.
    $cmd1 = "mkdir -p $parent"
    $cmd2 = "echo $b64 | base64 -d > $Path"

    Invoke-SandboxCmd $cmd1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "mkdir -p $parent failed (exit $LASTEXITCODE)" }

    Invoke-SandboxCmd $cmd2 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "write to $Path failed (exit $LASTEXITCODE)" }
}

function Read-SandboxFile {
    param([string]$Path)
    $out = Invoke-SandboxCmd "cat $Path 2>/dev/null || true"
    return ($out | Out-String).Trim()
}

# ============================================================================
#  PROVIDER DEFINITIONS
# ============================================================================
$PROVIDERS = [ordered]@{
    "ollama-cloud" = @{
        label       = "Ollama Cloud - no key, uses your Windows Ollama daemon (DEFAULT)"
        needsKey    = $false
        keyHint     = "Requires the Windows Ollama app running and signed in (ollama signin)."
        baseUrlFn   = {
            if ($script:Backend -eq "vm") { "http://10.0.2.2:11434" }
            else                          { "http://host.docker.internal:11434" }
        }
        authToken   = "ollama"
        fetchModels = { Get-OllamaCloudModels }
        defaultLead = "gpt-oss:120b-cloud"
        defaultWork = "gpt-oss:120b-cloud"
    }
    "openrouter" = @{
        label       = "OpenRouter - 300+ models via one key"
        needsKey    = $true
        keyHint     = "Get your key at https://openrouter.ai/keys (starts with sk-or-)"
        baseUrlFn   = { "https://openrouter.ai/api" }
        authToken   = "_FROM_KEY_"
        fetchModels = { param($k) Get-OpenRouterModels }
        defaultLead = "anthropic/claude-sonnet-4"
        defaultWork = "anthropic/claude-haiku-4"
    }
    "anthropic" = @{
        label       = "Anthropic - official Anthropic API (paid)"
        needsKey    = $true
        keyHint     = "Get your key at https://console.anthropic.com/keys"
        baseUrlFn   = { "" }
        authToken   = ""
        fetchModels = { param($k) Get-AnthropicModels -Key $k }
        defaultLead = "claude-sonnet-4-5"
        defaultWork = "claude-haiku-4-5"
    }
    "ollama-local" = @{
        label       = "Ollama Local - your hardware, fully private"
        needsKey    = $false
        keyHint     = "Pull a model first: ollama pull qwen2.5-coder:7b (inside sandbox)"
        baseUrlFn   = {
            if ($script:Backend -eq "vm") { "http://10.0.2.2:11434" }
            else                          { "http://host.docker.internal:11434" }
        }
        authToken   = "ollama"
        fetchModels = { Get-OllamaLocalModels }
        defaultLead = "qwen2.5-coder:7b"
        defaultWork = "qwen2.5-coder:7b"
    }
}

# ============================================================================
#  DYNAMIC MODEL FETCHERS
# ============================================================================
function Get-OpenRouterModels {
    try {
        $r = Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models" -TimeoutSec 15
        $priority = @("anthropic/", "openai/", "google/", "meta-llama/", "mistralai/", "deepseek/", "qwen/", "moonshotai/")
        $models = $r.data | ForEach-Object { $_.id }
        $sorted = @()
        foreach ($p in $priority) {
            $sorted += ($models | Where-Object { $_ -like "$p*" } | Sort-Object)
        }
        $rest = $models | Where-Object {
            $m = $_
            $matched = $false
            foreach ($p in $priority) { if ($m -like "$p*") { $matched = $true; break } }
            -not $matched
        } | Sort-Object
        $sorted += $rest
        return $sorted
    } catch {
        Write-Warn "Could not fetch OpenRouter model list: $($_.Exception.Message)"
        return @("anthropic/claude-sonnet-4","anthropic/claude-haiku-4","google/gemini-2.5-pro","openai/gpt-4o","meta-llama/llama-3.3-70b-instruct:free")
    }
}

function Get-AnthropicModels {
    param([string]$Key)
    if (-not $Key) { return @() }
    try {
        $h = @{ "x-api-key" = $Key; "anthropic-version" = "2023-06-01" }
        $r = Invoke-RestMethod -Uri "https://api.anthropic.com/v1/models" -Headers $h -TimeoutSec 15
        return ($r.data | ForEach-Object { $_.id } | Sort-Object -Descending)
    } catch {
        Write-Warn "Could not fetch Anthropic model list: $($_.Exception.Message)"
        return @("claude-sonnet-4-5","claude-opus-4-5","claude-haiku-4-5")
    }
}

function Get-OllamaCloudModels {
    # Ollama Cloud has no public list-all API. Curated list + cached locally.
    $curated = @(
        "gpt-oss:120b-cloud","gpt-oss:20b-cloud",
        "kimi-k2:cloud","qwen3-coder:480b-cloud",
        "deepseek-v3.1:671b-cloud","glm-4.6:cloud",
        "minimax-m2:cloud"
    )
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5
        $local = $r.models | ForEach-Object { $_.name } | Where-Object { $_ -like "*:cloud" }
        if ($local) { $curated = @(($curated + $local) | Sort-Object -Unique) }
    } catch {}
    return $curated
}

function Get-OllamaLocalModels {
    $hostUrl = if ($script:Backend -eq "vm") { "http://10.0.2.2:11434" } else { "http://host.docker.internal:11434" }
    $raw = Invoke-SandboxCmd "curl -s --max-time 5 $hostUrl/api/tags 2>/dev/null"
    try {
        $j = ($raw | Out-String) | ConvertFrom-Json
        $names = $j.models | ForEach-Object { $_.name } | Where-Object { $_ -notlike "*:cloud" }
        if (-not $names) { return @("(no local models - run: ollama pull qwen2.5-coder:7b)") }
        return @($names | Sort-Object)
    } catch {
        return @("(could not reach Ollama - is it running?)")
    }
}

# ============================================================================
#  MODEL PICKER
# ============================================================================
function Select-Model {
    param([string]$Prompt, [string[]]$Models, [string]$Default)
    if (-not $Models -or $Models.Count -eq 0) {
        return Read-Text $Prompt $Default
    }
    Write-Host ""
    Write-Info "Available models (top 20 shown; type any model id to override):"
    $shown = $Models | Select-Object -First 20
    for ($i = 0; $i -lt $shown.Count; $i++) {
        $marker = if ($Default -and $shown[$i] -eq $Default) { ">" } else { " " }
        Write-Host "    $marker [$($i+1)] $($shown[$i])" -ForegroundColor Gray
    }
    Write-Host ""
    $raw = Read-Text "$Prompt (number, name, or Enter for default)" $Default
    if ($raw -match '^\d+$') {
        $n = [int]$raw - 1
        if ($n -ge 0 -and $n -lt $shown.Count) { return $shown[$n] }
    }
    return $raw
}

# ============================================================================
#  MAIN
# ============================================================================
Clear-Host
Write-Host ""
Write-Host "  +------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |   Genesis - AI Provider + Model Picker               |" -ForegroundColor Cyan
Write-Host "  +------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

$script:Backend = Get-Backend $Backend
Write-Ok "Backend: $($script:Backend.ToUpper())"

# Auto-start the sandbox if it isn't already running.
if ($script:Backend -eq "vm") {
    $repo = Join-Path $env:USERPROFILE "genesis"
    Push-Location $repo
    try {
        $status = & vagrant status --machine-readable 2>$null | Select-String "state,"
        if ($status -and $status -notmatch "running") {
            Write-Step "VM is not running - starting it now (vagrant up)..."
            & vagrant up
            if ($LASTEXITCODE -ne 0) {
                Write-Fail "vagrant up failed. Check VirtualBox / Hyper-V conflicts."
                exit 1
            }
            Write-Ok "VM started"
        }
    } finally { Pop-Location }
}

$probe = Invoke-SandboxCmd "echo __genesis_alive__" -Quiet
if ($probe -notmatch "__genesis_alive__") {
    Write-Fail "Sandbox unreachable. Output: $probe"
    Write-Info "For VM:  cd `$env:USERPROFILE\genesis; vagrant up"
    Write-Info "For WSL: wsl -d Ubuntu"
    exit 1
}

Write-Header "Provider"
if (-not $Provider) {
    $keys  = @($PROVIDERS.Keys)
    $descs = @($keys | ForEach-Object { $PROVIDERS[$_].label })
    $idx   = Read-Choice "Select AI provider" $descs 0
    $Provider = $keys[$idx]
}
$prov = $PROVIDERS[$Provider]
Write-Ok "Selected: $Provider"
Write-Info "  $($prov.keyHint)"

$apiKey = ""
if ($prov.needsKey) {
    $apiKey = Read-Text "API key" -Required -Secret
}

Write-Header "Models"
Write-Step "Fetching model list..."
$models = @()
try {
    if ($prov.needsKey) {
        $models = & $prov.fetchModels $apiKey
    } else {
        $models = & $prov.fetchModels
    }
    if ($models -and $models.Count -gt 0) {
        Write-Ok "Found $($models.Count) models"
    }
} catch {
    Write-Warn "Model fetch failed: $($_.Exception.Message)"
    $models = @()
}

if (-not $LeaderModel) { $LeaderModel = Select-Model "Leader model (orchestration)" $models $prov.defaultLead }
if (-not $WorkerModel) { $WorkerModel = Select-Model "Worker model (execution)    " $models $prov.defaultWork }

Write-Ok "Leader: $LeaderModel"
Write-Ok "Worker: $WorkerModel"

$baseUrl  = & $prov.baseUrlFn
$authTok  = if ($prov.authToken -eq "_FROM_KEY_") { $apiKey } else { $prov.authToken }

$existing = Read-SandboxFile "~/.claude/settings.json"
$settings = @{}
if ($existing -and $existing.Length -gt 2) {
    try { $settings = ConvertTo-Hashtable ($existing | ConvertFrom-Json) } catch { $settings = @{} }
}
if (-not $settings.ContainsKey('env')) { $settings['env'] = @{} }
$envBlk = ConvertTo-Hashtable $settings['env']

foreach ($k in @("ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY",
                 "ANTHROPIC_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL","ANTHROPIC_DEFAULT_HAIKU_MODEL",
                 "ANTHROPIC_DEFAULT_OPUS_MODEL")) {
    if ($envBlk.ContainsKey($k)) { $envBlk.Remove($k) }
}

if ($baseUrl)  { $envBlk["ANTHROPIC_BASE_URL"]   = $baseUrl }
if ($authTok)  { $envBlk["ANTHROPIC_AUTH_TOKEN"] = $authTok }
if ($Provider -eq "anthropic") { $envBlk["ANTHROPIC_API_KEY"] = $apiKey }

$envBlk["ANTHROPIC_MODEL"]                = $LeaderModel
$envBlk["ANTHROPIC_DEFAULT_SONNET_MODEL"] = $LeaderModel
$envBlk["ANTHROPIC_DEFAULT_OPUS_MODEL"]   = $LeaderModel
$envBlk["ANTHROPIC_DEFAULT_HAIKU_MODEL"]  = $WorkerModel
$envBlk["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"

$settings['env'] = $envBlk

$json = $settings | ConvertTo-Json -Depth 20
Write-Step "Writing ~/.claude/settings.json inside sandbox..."
Invoke-SandboxCmd "cp ~/.claude/settings.json ~/.claude/settings.json.bak 2>/dev/null || true" | Out-Null
Write-SandboxFile "~/.claude/settings.json" $json
Write-Ok "Wrote provider config"

Write-Header "Done"
Write-Info "Settings : ~/.claude/settings.json (backup at .bak)"
Write-Info "Backend  : $($script:Backend.ToUpper())"
Write-Info "Provider : $Provider"
Write-Info "Leader   : $LeaderModel"
Write-Info "Worker   : $WorkerModel"
Write-Host ""
Write-Host "  Test it:" -ForegroundColor White
if ($script:Backend -eq "vm") {
    Write-Host "    cd `$env:USERPROFILE\genesis; vagrant ssh" -ForegroundColor White
} else {
    Write-Host "    wsl -d Ubuntu" -ForegroundColor White
}
Write-Host "    claude                               # new session picks up the new provider" -ForegroundColor White
Write-Host ""
