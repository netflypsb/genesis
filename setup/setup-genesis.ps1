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

.PARAMETER Enable
    Comma-separated list of catalog item names to force-enable (overrides
    `default: false`). Matches names in catalog/*.json.

.PARAMETER Disable
    Comma-separated list of catalog item names to force-disable (overrides
    `default: true`). Matches names in catalog/*.json.

.PARAMETER VMFirst
    Implies -Mode vm. Exports the VM's SSH config for VS Code Remote-SSH,
    writes ~/.genesis/vm-config.json, and prints VM-first next-steps
    tailored for treating the VM as your daily-driver sandbox (projects
    inside the VM, not on Windows).

.PARAMETER SyncProjects
    Absolute Windows path to sync into the VM at /home/vagrant/shared-projects.
    Opt-in: default does NOT mount any Windows directories inside the VM
    (the whole point of VM-first is isolation). Only set this if you want
    to edit files from Windows-native apps.

.PARAMETER RepoUrl
    Git URL to clone inside the sandbox. Default: https://github.com/netflypsb/genesis.git

.EXAMPLE
    .\setup\setup-genesis.ps1
    # WSL backend, default install

.EXAMPLE
    .\setup\setup-genesis.ps1 -VMFirst
    # Vagrant VM, VM-first workflow, VS Code Remote-SSH ready

.EXAMPLE
    .\setup\setup-genesis.ps1 -Enable vibe-trading -Disable playwright
#>
[CmdletBinding()]
param(
    [ValidateSet("wsl", "vm")]
    [string] $Mode = "wsl",

    [string] $Distro = "Ubuntu",
    [switch] $SkipSkills,
    [switch] $SkipMcps,
    [switch] $SkipOpenClaw,
    [switch] $AutoSignin,
    [switch] $VMFirst,
    [string] $SyncProjects = "",
    [string] $Enable = "",
    [string] $Disable = "",
    [string] $RepoUrl = "https://github.com/netflypsb/genesis.git",
    [string] $RepoRef = "main"
)

# -VMFirst implies -Mode vm (users don't have to type both).
if ($VMFirst -and $Mode -ne "vm") { $Mode = "vm" }

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

# --- PATH self-healing ---------------------------------------------------
# Prepend $Dir to both the current session PATH and the persistent user PATH
# (so newly-spawned shells see it too). Idempotent.
function Add-ToUserPath {
    param([Parameter(Mandatory)][string]$Dir)
    $sep  = [IO.Path]::PathSeparator
    if (($env:Path -split [regex]::Escape($sep)) -notcontains $Dir) {
        $env:Path = "$Dir$sep$env:Path"
    }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    if (($userPath -split [regex]::Escape($sep)) -notcontains $Dir) {
        [Environment]::SetEnvironmentVariable("Path", "$Dir$sep$userPath".TrimEnd($sep), "User")
        Write-Step "added to user PATH: $Dir"
    }
}

# Resolve a tool by command name, falling back to a list of well-known install
# paths. If found off-PATH, heals the user PATH. Returns the full path or $null.
#
#   Resolve-Tool -Name ollama -Candidates @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", ...)
function Resolve-Tool {
    param(
        [Parameter(Mandatory)][string]   $Name,
        [Parameter(Mandatory)][string[]] $Candidates
    )
    # 1. On PATH? Done.
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 2. Walk candidate paths, return first match + heal PATH.
    foreach ($p in $Candidates) {
        if ($p -and (Test-Path $p)) {
            Add-ToUserPath -Dir (Split-Path -Parent $p)
            Write-Ok "found $Name at $p (PATH healed)"
            return $p
        }
    }
    return $null
}

# Install a tool via winget if available; otherwise give the user a direct
# download URL and wait for them to finish. Returns $true on success.
function Install-Tool {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][string] $WingetId,
        [string] $DownloadUrl = ""
    )
    $wing = Get-Command winget -ErrorAction SilentlyContinue
    if ($wing) {
        Write-Step "winget install -e --id $WingetId ..."
        & winget install -e --id $WingetId --accept-package-agreements --accept-source-agreements
        return ($LASTEXITCODE -eq 0)
    }
    Write-Warn "winget not available on this system."
    if ($DownloadUrl) {
        Write-Warn "Download $Name manually: $DownloadUrl"
        Write-Warn "Run the installer, then press ENTER to continue (or Ctrl+C to abort)."
        Read-Host "waiting"
        return $true
    }
    return $false
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
$ollamaCandidates = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe",
    "${env:ProgramFiles(x86)}\Ollama\ollama.exe"
)
$ollamaPath = Resolve-Tool -Name "ollama" -Candidates $ollamaCandidates
if (-not $ollamaPath) {
    Write-Warn "ollama.exe not found on PATH or at standard install locations."
    if (Read-YesNo "Install Ollama Desktop now?" $true) {
        Install-Tool -Name "Ollama" -WingetId "Ollama.Ollama" -DownloadUrl "https://ollama.com/download/OllamaSetup.exe" | Out-Null
        $ollamaPath = Resolve-Tool -Name "ollama" -Candidates $ollamaCandidates
    }
}
$ollamaCmd = if ($ollamaPath) { Get-Command ollama -ErrorAction SilentlyContinue } else { $null }
if ($ollamaCmd) {
    Write-Ok  "ollama: $($ollamaCmd.Source)"

    # Ensure OLLAMA_HOST=0.0.0.0:11434 so WSL can reach the daemon via
    # host.docker.internal. Default binds to 127.0.0.1 which blocks WSL.
    $currentHost = [Environment]::GetEnvironmentVariable("OLLAMA_HOST", "User")
    if ($currentHost -ne "0.0.0.0:11434") {
        Write-Step "setting OLLAMA_HOST=0.0.0.0:11434 (User scope) so WSL can connect"
        [Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
        $env:OLLAMA_HOST = "0.0.0.0:11434"
        # Restart Ollama for the env change to take effect
        Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    # Firewall rule for WSL<->Ollama (inbound 11434, user's current profile)
    $fwRule = Get-NetFirewallRule -DisplayName "Ollama (WSL)" -ErrorAction SilentlyContinue
    if (-not $fwRule) {
        try {
            New-NetFirewallRule -DisplayName "Ollama (WSL)" -Direction Inbound -Protocol TCP `
                -LocalPort 11434 -Action Allow -Profile Any -ErrorAction Stop | Out-Null
            Write-Ok "firewall rule 'Ollama (WSL)' added"
        } catch {
            Write-Warn "could not add firewall rule (needs admin). WSL->Ollama may be blocked."
            Write-Warn "run as admin: New-NetFirewallRule -DisplayName 'Ollama (WSL)' -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow"
        }
    }

    # Check daemon. If OLLAMA_HOST was just changed we stopped it, so try to start.
    $reachable = $false
    try {
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://localhost:11434/api/tags"
        if ($r.StatusCode -eq 200) { $reachable = $true }
    } catch {}
    if (-not $reachable) {
        Write-Warn "daemon NOT reachable on localhost:11434. Starting it..."
        $appExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
        if (Test-Path $appExe) {
            Start-Process -FilePath $appExe
        } else {
            Start-Process -FilePath $ollamaCmd.Source -ArgumentList "serve" -WindowStyle Hidden
        }
        Start-Sleep -Seconds 4
        try {
            $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://localhost:11434/api/tags"
            if ($r.StatusCode -eq 200) { $reachable = $true }
        } catch {}
    }
    if ($reachable) {
        Write-Ok "daemon reachable at http://localhost:11434"
    } else {
        Write-Warn "daemon still not reachable. Launch Ollama Desktop manually, then rerun."
    }

    # `ollama signin` is idempotent; safe to run even if already signed-in.
    if ($AutoSignin -or (Read-YesNo "Run 'ollama signin' now? (skip if already signed in)" $true)) {
        & $ollamaCmd.Source signin
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
        if ($distros.Count -gt 0) {
            $fallback = $distros[0]
            if (Read-YesNo "Use existing distro '$fallback' instead?" $true) {
                $Distro = $fallback
                Write-Ok "using distro: $Distro"
            }
        }
        if ($distros -notcontains $Distro) {
            if (Read-YesNo "Install '$Distro' now? (downloads ~600 MB)" $true) {
                wsl --install -d $Distro --no-launch
                if ($LASTEXITCODE -ne 0) {
                    Write-Err "wsl --install failed. Your WSL version may not have '$Distro' in its catalog."
                    Write-Warn "Run 'wsl --list --online' to see valid names, then rerun with -Distro <name>."
                    Write-Warn "Common valid names: Ubuntu, Ubuntu-22.04, Ubuntu-24.04, Debian"
                    exit 1
                }
                Write-Ok "Installed $Distro. Open it once to create a user, then rerun this script."
                exit 2
            } else {
                Write-Err "No usable distro. Aborting."
                exit 1
            }
        }
    } else {
        Write-Ok "using distro: $Distro"
    }

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
    if ($Enable)       { $envFlags += "GENESIS_ENABLE='$Enable'" }
    if ($Disable)      { $envFlags += "GENESIS_DISABLE='$Disable'" }

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
    Write-Host "Inside WSL (run 'wsl -d $Distro' first):" -ForegroundColor Cyan
    Write-Host "  claude mcp list                    # verify MCP user-scope entries" -ForegroundColor White
    Write-Host "  clawteam --version                 # verify ClawTeam"               -ForegroundColor White
    Write-Host "  openclaw --version                 # verify OpenClaw"                -ForegroundColor White
    Write-Host "  curl http://host.docker.internal:11434/api/tags  # WSL->host Ollama" -ForegroundColor White
    Write-Host ""
    Write-Host "On Windows (this PowerShell, not WSL):" -ForegroundColor Cyan
    Write-Host '  ollama run gpt-oss:120b-cloud "hi"  # smoke-test the cloud model'    -ForegroundColor White
    Write-Host ""
    Write-Host "Ollama runs only on Windows. WSL reaches it via host.docker.internal." -ForegroundColor DarkGray
}

if ($Mode -eq "vm") {
    # =============================================================== VM path
    Write-Header "Phase 2 - Vagrant VM backend"
    if ([int]$gbRam -lt 16) {
        Write-Warn "Host has only $gbRam GB RAM. VM will claim 8 GB; this may stress your host."
        if (-not (Read-YesNo "Continue?" $false)) { exit 0 }
    }

    $tools = @(
        @{
            Cmd        = "VBoxManage"
            WingetId   = "Oracle.VirtualBox"
            Download   = "https://www.virtualbox.org/wiki/Downloads"
            Candidates = @(
                "$env:ProgramFiles\Oracle\VirtualBox\VBoxManage.exe",
                "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe"
            )
        },
        @{
            Cmd        = "vagrant"
            WingetId   = "Hashicorp.Vagrant"
            Download   = "https://developer.hashicorp.com/vagrant/downloads"
            Candidates = @(
                "$env:ProgramFiles\Vagrant\bin\vagrant.exe",
                "${env:ProgramFiles(x86)}\Vagrant\bin\vagrant.exe",
                "$env:HashiCorp_HOME\Vagrant\bin\vagrant.exe"
            )
        }
    )
    foreach ($tool in $tools) {
        $found = Resolve-Tool -Name $tool.Cmd -Candidates $tool.Candidates
        if (-not $found) {
            Write-Warn "$($tool.Cmd) not found (PATH + standard locations)."
            if (Read-YesNo "Install $($tool.WingetId) now?" $true) {
                Install-Tool -Name $tool.Cmd -WingetId $tool.WingetId -DownloadUrl $tool.Download | Out-Null
                $found = Resolve-Tool -Name $tool.Cmd -Candidates $tool.Candidates
            }
        }
        if (-not $found) {
            Write-Err "Cannot proceed without $($tool.Cmd). Install it and re-run."
            Write-Err "Direct download: $($tool.Download)"
            exit 1
        }
        Write-Ok "$($tool.Cmd): $found"
    }

    # Hyper-V conflict detection (best-effort; requires admin on some SKUs)
    $hv = $null
    try {
        $hv = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop).State
    } catch {
        # Not elevated or Home edition — fall back to reading boot config.
        $bcd = bcdedit /enum 2>$null | Select-String "hypervisorlaunchtype"
        if ($bcd -and $bcd.ToString() -notmatch "Off") { $hv = "Likely-Enabled" }
    }
    if ($hv -eq "Enabled" -or $hv -eq "Likely-Enabled") {
        Write-Warn "Hyper-V platform is active. VirtualBox will run (paravirt) but slower."
        Write-Warn "To fully disable (admin + reboot): bcdedit /set hypervisorlaunchtype off"
    }

    if (-not (Test-Path $VagrantFile)) {
        Write-Err "Vagrantfile not found at $VagrantFile"
        exit 1
    }

    Write-Header "Phase 3 - vagrant up"
    Push-Location $RepoRoot
    # Export catalog + skip env for the Vagrantfile to forward to provision.sh.
    $env:GENESIS_ENABLE        = $Enable
    $env:GENESIS_DISABLE       = $Disable
    $env:GENESIS_SKIP_SKILLS   = if ($SkipSkills)   { "1" } else { "0" }
    $env:GENESIS_SKIP_MCPS     = if ($SkipMcps)     { "1" } else { "0" }
    $env:GENESIS_SKIP_OPENCLAW = if ($SkipOpenClaw) { "1" } else { "0" }
    if ($SyncProjects) {
        if (Test-Path $SyncProjects) {
            $env:GENESIS_SYNC_PROJECTS = $SyncProjects
            Write-Ok "mounting $SyncProjects -> /home/vagrant/shared-projects (opt-in)"
        } else {
            Write-Warn "SyncProjects path not found: $SyncProjects (ignoring)"
        }
    }
    try {
        & vagrant up
        if ($LASTEXITCODE -ne 0) { throw "vagrant up failed" }
    } finally {
        Pop-Location
    }
    Write-Ok "VM provisioned"

    # --- VM-first extras: ssh config + vm-config.json ---
    if ($VMFirst) {
        Write-Header "Phase 4 - VM-first setup"
        $vmAlias  = "genesis-vm"
        $sshDir   = Join-Path $env:USERPROFILE ".ssh"
        $confDir  = Join-Path $sshDir "config.d"
        $mainCfg  = Join-Path $sshDir "config"
        $genCfg   = Join-Path $confDir "genesis"
        New-Item -ItemType Directory -Force -Path $confDir | Out-Null

        Push-Location $RepoRoot
        try {
            $sshRaw = & vagrant ssh-config 2>$null
            if ($LASTEXITCODE -eq 0 -and $sshRaw) {
                $sshCfg = ($sshRaw -split "`r?`n") -replace "^Host default\s*$", "Host $vmAlias" -join "`n"
                Set-Content -Path $genCfg -Value $sshCfg -Encoding ASCII
                Write-Ok "wrote $genCfg  (alias: $vmAlias)"
            } else {
                Write-Warn "vagrant ssh-config failed; skipping SSH config export"
            }
        } finally {
            Pop-Location
        }

        if (-not (Test-Path $mainCfg)) {
            Set-Content -Path $mainCfg -Value "Include config.d/*`n" -Encoding ASCII
            Write-Ok "created $mainCfg"
        } elseif ((Get-Content $mainCfg -Raw) -notmatch 'Include\s+config\.d') {
            Add-Content -Path $mainCfg -Value "`nInclude config.d/*`n" -Encoding ASCII
            Write-Ok "appended Include config.d/* to $mainCfg"
        }

        # vm-config.json — consumed by scripts/open-vm-in-vscode.ps1 and future helpers.
        $genesisCfgDir = Join-Path $env:USERPROFILE ".genesis"
        New-Item -ItemType Directory -Force -Path $genesisCfgDir | Out-Null
        $vmCfg = [ordered]@{
            mode         = "vm-first"
            repoRoot     = $RepoRoot
            vmName       = "genesis-dev"
            sshAlias     = $vmAlias
            defaultPath  = "/home/vagrant/projects"
            provisioned  = (Get-Date).ToString("o")
        } | ConvertTo-Json
        Set-Content -Path (Join-Path $genesisCfgDir "vm-config.json") -Value $vmCfg -Encoding ASCII
        Write-Ok "wrote ~/.genesis/vm-config.json"
    }

    Write-Header "Next steps"
    if ($VMFirst) {
        Write-Host "Daily use (VM-first):" -ForegroundColor Cyan
        Write-Host "  cd $RepoRoot; vagrant ssh           # enter the VM"                         -ForegroundColor White
        Write-Host "  cd ~/projects && git clone <url>    # clone work into the VM's ext4 disk"   -ForegroundColor White
        Write-Host "  claude                              # Claude Code with MCPs + skills"       -ForegroundColor White
        Write-Host "  clawteam launch genesis-coder --goal '...' --workspace --repo ."           -ForegroundColor White
        Write-Host ""
        Write-Host "VS Code Remote-SSH (from Windows):" -ForegroundColor Cyan
        Write-Host "  .\scripts\open-vm-in-vscode.ps1     # opens ~/projects in VS Code"          -ForegroundColor White
        Write-Host "  .\scripts\open-vm-in-vscode.ps1 /home/vagrant/projects/my-app"              -ForegroundColor White
        Write-Host ""
        Write-Host "Snapshots (before risky agent runs):" -ForegroundColor Cyan
        Write-Host "  cd $RepoRoot; vagrant snapshot save pre-agent-run"                          -ForegroundColor White
        Write-Host "  vagrant snapshot restore pre-agent-run    # rewind in ~1 min"              -ForegroundColor White
        Write-Host "  See docs/vm-snapshots.md for the full workflow"                            -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "VM lifecycle:" -ForegroundColor Cyan
        Write-Host "  vagrant halt                        # stop, preserves state"               -ForegroundColor White
        Write-Host "  vagrant up                          # resume (next day)"                   -ForegroundColor White
        Write-Host "  vagrant destroy -f                  # tear down completely"                -ForegroundColor White
    } else {
        Write-Host "  cd $RepoRoot; vagrant ssh           # enter the VM"                         -ForegroundColor White
        Write-Host "  claude mcp list                     # verify MCP user-scope entries"        -ForegroundColor White
        Write-Host "  vagrant halt                        # stop the VM"                          -ForegroundColor White
        Write-Host "  vagrant destroy -f                  # tear it down"                         -ForegroundColor White
        Write-Host ""
        Write-Host "Tip: re-run with -VMFirst for VS Code Remote-SSH setup + snapshot hints"     -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Header "Provider + model configuration (optional)"
Write-Host "The wizard has written default settings pointing at Ollama Cloud." -ForegroundColor Gray
Write-Host "To switch provider (OpenRouter / Anthropic / Ollama Local) or pick specific" -ForegroundColor Gray
Write-Host "models, run the provider wizard. It works for both WSL and VM." -ForegroundColor Gray
if (Read-YesNo "Run the provider wizard now?" $false) {
    $providerScript = Join-Path $PSScriptRoot "setup-provider.ps1"
    if (Test-Path $providerScript) {
        & $providerScript
    } else {
        Write-Warn "setup-provider.ps1 not found at $providerScript"
    }
} else {
    Write-Info "Run it later:  .\setup\setup-provider.ps1"
}

Write-Host ""
Write-Header "Genesis setup complete"
