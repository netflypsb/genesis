#Requires -Version 5.1
<#
.SYNOPSIS
    Genesis setup wizard (v0.2.0): provisions a Linux sandbox on Windows for
    Claude Code + OpenClaw + ClawTeam + MCP servers + Claude skills.

.DESCRIPTION
    Two backends:
      -Mode wsl    (default) Uses WSL2 Ubuntu. Fast, no VM required.
      -Mode vm     Uses Vagrant + VirtualBox (fallback) for stronger isolation.

    Both backends share provision.sh at the repo root. One installer, two
    transports. Ollama Cloud is reached via the Windows host's Ollama Desktop.

.PARAMETER Mode
    wsl | vm

.PARAMETER Distro
    WSL distro name (default Ubuntu-24.04). Ignored in VM mode.

.PARAMETER SkipSkills
    Skip installing bundled Claude Code skills from ./skills/*.

.PARAMETER SkipMcps
    Skip `claude mcp add --scope user` registration.

.PARAMETER SkipOpenClaw
    Skip OpenClaw + ClawTeam install (Claude Code only).

.PARAMETER AutoSignin
    Run `ollama signin` on the host if Ollama is installed but not signed in.

.PARAMETER RepoUrl
    Git URL to clone inside the sandbox. Default: https://github.com/netflypsb/genesis.git

.EXAMPLE
    .\setup\setup-genesis.ps1

.EXAMPLE
    .\setup\setup-genesis.ps1 -Mode vm -SkipSkills
#>
[CmdletBinding()]
param(
    [ValidateSet("wsl", "vm")]
    [string] $Mode = "wsl",

    [string] $Distro = "Ubuntu-24.04",
    [switch] $SkipSkills,
    [switch] $SkipMcps,
    [switch] $SkipOpenClaw,
    [switch] $AutoSignin,
    [string] $RepoUrl = "https://github.com/netflypsb/genesis.git",
    [string] $RepoRef = "main"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ------------------------------------------------------------------ console
function Write-Header([string]$t) {
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host (" " + $t) -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
}
function Write-Step([string]$t)   { Write-Host "  - $t"  -ForegroundColor Gray }
function Write-Ok  ([string]$t)   { Write-Host "  OK $t" -ForegroundColor Green }
function Write-Warn([string]$t)   { Write-Host "  !  $t" -ForegroundColor Yellow }
function Write-Err ([string]$t)   { Write-Host "  X  $t" -ForegroundColor Red }

function Read-YesNo([string]$prompt, [bool]$default = $true) {
    $suffix = if ($default) { "[Y/n]" } else { "[y/N]" }
    while ($true) {
        $a = Read-Host "$prompt $suffix"
        if ([string]::IsNullOrWhiteSpace($a)) { return $default }
        switch ($a.Trim().ToLower()) {
            "y" { return $true }
            "yes" { return $true }
            "n" { return $false }
            "no" { return $false }
        }
    }
}

# ------------------------------------------------------------------ paths
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ProvisionScript = Join-Path $RepoRoot "provision.sh"
$VagrantFile = Join-Path $RepoRoot "Vagrantfile"

Write-Header "Genesis setup wizard --- mode: $Mode"
Write-Step "repo root:       $RepoRoot"
Write-Step "provision.sh:    $ProvisionScript"

if (-not (Test-Path $ProvisionScript)) {
    Write-Err "provision.sh not found at $ProvisionScript"
    Write-Err "Run this script from inside a clone of netflypsb/genesis."
    exit 1
}

# ------------------------------------------------------------------ phase 0: host
Write-Header "Phase 0 --- host capability check"
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$gbRam = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
$cpus  = $cs.NumberOfLogicalProcessors
$psVer = $PSVersionTable.PSVersion
Write-Step "OS:   $($os.Caption) $($os.Version)"
Write-Step "RAM:  $gbRam GB"
Write-Step "CPUs: $cpus logical"
Write-Step "PS:   $psVer"

if ([int]$os.BuildNumber -lt 19041) {
    Write-Err "Windows build $($os.BuildNumber) is below 19041; WSL2 requires 19041+."
    exit 1
}
Write-Ok "host OK"

# ------------------------------------------------------------------ phase 1: Ollama on host
Write-Header "Phase 1 --- Ollama on Windows host"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
    Write-Warn "ollama.exe not on PATH."
    if (Read-YesNo "Install Ollama Desktop via winget now?" $true) {
        winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
        $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    }
}
if ($ollamaCmd) {
    Write-Ok  "ollama: $($ollamaCmd.Source)"
    # Check daemon
    $reachable = $false
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://localhost:11434/api/tags"
        if ($r.StatusCode -eq 200) { $reachable = $true }
    } catch {}
    if ($reachable) {
        Write-Ok "daemon reachable at http://localhost:11434"
    } else {
        Write-Warn "daemon NOT reachable. Launch Ollama Desktop, then rerun this script."
        if (Read-YesNo "Try to start Ollama now?" $true) {
            Start-Process -FilePath $ollamaCmd.Source -ArgumentList "serve" -WindowStyle Hidden
            Start-Sleep -Seconds 3
        }
    }
    # Signin check: `ollama whoami` returns success if signed in.
    $signedIn = $false
    try {
        $out = & $ollamaCmd.Source whoami 2>&1
        if ($LASTEXITCODE -eq 0 -and $out -notmatch "not signed") { $signedIn = $true }
    } catch {}
    if ($signedIn) {
        Write-Ok "ollama signed-in"
    } else {
        Write-Warn "Not signed in to ollama.com. Cloud models need 'ollama signin'."
        if ($AutoSignin -or (Read-YesNo "Run 'ollama signin' now?" $true)) {
            & $ollamaCmd.Source signin
        }
    }
} else {
    Write-Warn "Continuing without host-side Ollama. You'll need to set ANTHROPIC_BASE_URL manually later."
}

# ------------------------------------------------------------------ branch
if ($Mode -eq "wsl") {
    # ============================================================== WSL path
    Write-Header "Phase 2 --- WSL2 backend"
    # Ensure WSL platform
    try {
        $wslVersion = wsl --version 2>$null
        if (-not $wslVersion) { throw "wsl --version returned empty" }
        Write-Ok "WSL present"
    } catch {
        Write-Warn "WSL not available. Installing (this may require reboot)..."
        wsl --install --no-distribution
        Write-Err "WSL installed. Reboot Windows, then rerun this script."
        exit 2
    }

    # Distro selection
    $distros = @(wsl -l -q 2>$null | ForEach-Object { ($_ -replace '\x00','').Trim() } | Where-Object { $_ -and $_ -notmatch '^docker-desktop' })
    if ($distros -notcontains $Distro) {
        Write-Warn "Distro '$Distro' not installed."
        if (Read-YesNo "Install '$Distro' now? (downloads ~600 MB)" $true) {
            wsl --install -d $Distro --no-launch
            Write-Ok "Requested install of $Distro. If first run, open the distro once to create a user, then rerun."
            exit 2
        } elseif ($distros.Count -gt 0) {
            $Distro = $distros[0]
            Write-Warn "Falling back to existing distro: $Distro"
        } else {
            Write-Err "No usable distro. Run: wsl --install -d Ubuntu-24.04"
            exit 1
        }
    }
    Write-Ok "using distro: $Distro"

    # Copy provision.sh into the distro home and exec it.
    Write-Step "pushing provision.sh into ${Distro}:~/genesis-provision.sh"
    $shContent = [IO.File]::ReadAllText($ProvisionScript) -replace "`r`n","`n"
    $tmp = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmp, $shContent, [System.Text.UTF8Encoding]::new($false))
    $wslTmp = (& wsl.exe -d $Distro -- wslpath ($tmp -replace '\\','/')).Trim()
    $q = [char]39  # single quote
    $copyCmd = "cp ${q}${wslTmp}${q} " + [char]36 + "HOME/genesis-provision.sh && chmod +x " + [char]36 + "HOME/genesis-provision.sh"
    & wsl.exe -d $Distro -- bash -c $copyCmd
    Remove-Item $tmp -Force

    # provision.sh defaults GENESIS_OLLAMA_HOST to host.docker.internal:11434,
    # which WSL2 resolves to the Windows host automatically. No override needed.
    $envFlags = @()
    $envFlags += "GENESIS_REPO_URL='$RepoUrl'"
    $envFlags += "GENESIS_REPO_REF='$RepoRef'"
    if ($SkipSkills)   { $envFlags += "GENESIS_SKIP_SKILLS=1" }
    if ($SkipMcps)     { $envFlags += "GENESIS_SKIP_MCPS=1" }
    if ($SkipOpenClaw) { $envFlags += "GENESIS_SKIP_OPENCLAW=1" }

    $envStr = $envFlags -join " "
    Write-Header "Phase 3 - provisioning inside WSL ($Distro)"
    Write-Step "env: $envStr"
    # Use login shell so PATH picks up ~/.local/bin after uv/claude install.
    $runCmd = "$envStr bash " + [char]36 + "HOME/genesis-provision.sh"
    & wsl.exe -d $Distro -- bash -lc $runCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Err "provisioning failed with exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Write-Ok "WSL provisioning complete"

    Write-Header "Next steps"
    Write-Host "  wsl -d $Distro                     # enter the sandbox" -ForegroundColor White
    Write-Host "  claude mcp list                    # verify MCP user-scope entries" -ForegroundColor White
    Write-Host "  clawteam --version                 # verify ClawTeam" -ForegroundColor White
    Write-Host "  openclaw --version                 # verify OpenClaw" -ForegroundColor White
    Write-Host '  ollama run gpt-oss:120b-cloud hi   # test cloud model (on host)' -ForegroundColor White
}

if ($Mode -eq "vm") {
    # =============================================================== VM path
    Write-Header "Phase 2 - Vagrant VM backend"
    if ([int]$gbRam -lt 16) {
        Write-Warn "Host has only $gbRam GB RAM. VM will claim 8 GB; this may stress your host."
        if (-not (Read-YesNo "Continue?" $false)) { exit 0 }
    }

    foreach ($tool in @(@{id="Oracle.VirtualBox"; cmd="VBoxManage"}, @{id="Hashicorp.Vagrant"; cmd="vagrant"})) {
        if (-not (Get-Command $tool.cmd -ErrorAction SilentlyContinue)) {
            Write-Warn "$($tool.cmd) not found."
            if (Read-YesNo "Install $($tool.id) via winget?" $true) {
                winget install -e --id $tool.id --accept-package-agreements --accept-source-agreements
            } else {
                Write-Err "Cannot proceed without $($tool.id). Aborting."
                exit 1
            }
        } else {
            Write-Ok "$($tool.cmd) found"
        }
    }

    # Hyper-V conflict detection
    $hv = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction SilentlyContinue).State
    if ($hv -eq "Enabled") {
        Write-Warn "Hyper-V is enabled. VirtualBox perf will be degraded."
        Write-Warn "Consider: bcdedit /set hypervisorlaunchtype off  (reboot required)"
    }

    if (-not (Test-Path $VagrantFile)) {
        Write-Err "Vagrantfile not found at $VagrantFile"
        exit 1
    }

    Write-Header "Phase 3 - vagrant up"
    Push-Location $RepoRoot
    try {
        & vagrant up
        if ($LASTEXITCODE -ne 0) { throw "vagrant up failed" }
    } finally {
        Pop-Location
    }

    Write-Ok "VM provisioned"
    Write-Header "Next steps"
    Write-Host "  cd $RepoRoot; vagrant ssh          # enter the VM" -ForegroundColor White
    Write-Host "  claude mcp list                    # verify MCP user-scope entries" -ForegroundColor White
    Write-Host "  vagrant halt                       # stop the VM" -ForegroundColor White
    Write-Host "  vagrant destroy -f                 # tear it down" -ForegroundColor White
}

Write-Host ""
Write-Header "Genesis setup complete"
