#Requires -Version 5.1
<#
.SYNOPSIS
    Opens the Genesis VM in VS Code via Remote-SSH.

.DESCRIPTION
    1. Captures `vagrant ssh-config` output and writes it to
       ~/.ssh/config.d/genesis (alias: Host genesis-vm).
    2. Ensures ~/.ssh/config has an `Include config.d/*` directive.
    3. Launches VS Code with `code --folder-uri` targeting the VM path.

    Requires the VS Code Remote-SSH extension. Will attempt to install it
    if `code` is available and the extension is missing.

.PARAMETER ProjectPath
    Path inside the VM to open. Default: /home/vagrant/projects.

.PARAMETER VMHostAlias
    Name to use for the SSH host alias. Default: genesis-vm.

.EXAMPLE
    .\scripts\open-vm-in-vscode.ps1
    # Opens /home/vagrant/projects in VS Code

.EXAMPLE
    .\scripts\open-vm-in-vscode.ps1 -ProjectPath /home/vagrant/projects/my-app
#>
[CmdletBinding()]
param(
    [string] $ProjectPath = "/home/vagrant/projects",
    [string] $VMHostAlias = "genesis-vm"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$t) { Write-Host "  - $t" -ForegroundColor Gray }
function Write-Ok  ([string]$t) { Write-Host "  OK $t" -ForegroundColor Green }
function Write-Warn([string]$t) { Write-Host "  !  $t" -ForegroundColor Yellow }
function Write-Err ([string]$t) { Write-Host "  X  $t" -ForegroundColor Red }

# 1. Locate the Genesis repo (this script lives in scripts/).
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot "Vagrantfile"))) {
    Write-Err "Vagrantfile not found at $RepoRoot. Run this script from the Genesis repo."
    exit 1
}

# 2. Ensure the VM is running.
Push-Location $RepoRoot
try {
    $status = & vagrant status --machine-readable 2>$null | Where-Object { $_ -match ',state,' } | Select-Object -First 1
    if ($status -notmatch "running") {
        Write-Warn "VM is not running. Starting it now..."
        & vagrant up
        if ($LASTEXITCODE -ne 0) { throw "vagrant up failed" }
    } else {
        Write-Ok "VM is running"
    }

    # 3. Grab ssh-config and rewrite the `Host` line to our alias.
    $sshConfigRaw = & vagrant ssh-config 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sshConfigRaw)) {
        Write-Err "vagrant ssh-config failed"
        exit 1
    }
    # Normalize output; vagrant emits 'Host default' by default.
    $sshConfig = ($sshConfigRaw -split "`r?`n") -replace "^Host default\s*$", "Host $VMHostAlias" -join "`n"
} finally {
    Pop-Location
}

# 4. Write to ~/.ssh/config.d/genesis and ensure main config Includes it.
$sshDir  = Join-Path $env:USERPROFILE ".ssh"
$confDir = Join-Path $sshDir "config.d"
$mainCfg = Join-Path $sshDir "config"
$genCfg  = Join-Path $confDir "genesis"
New-Item -ItemType Directory -Force -Path $confDir | Out-Null
Set-Content -Path $genCfg -Value $sshConfig -Encoding ASCII
Write-Ok "wrote $genCfg (Host $VMHostAlias)"

if (-not (Test-Path $mainCfg)) {
    Set-Content -Path $mainCfg -Value "Include config.d/*`n" -Encoding ASCII
    Write-Ok "created $mainCfg with Include config.d/*"
} else {
    $existing = Get-Content $mainCfg -Raw
    if ($existing -notmatch 'Include\s+config\.d') {
        Add-Content -Path $mainCfg -Value "`nInclude config.d/*`n" -Encoding ASCII
        Write-Ok "appended Include config.d/* to $mainCfg"
    } else {
        Write-Step "~/.ssh/config already has Include config.d"
    }
}

# 5. Locate the VS Code CLI (PATH first, then common install locations).
$codeCmd = Get-Command code -ErrorAction SilentlyContinue
if (-not $codeCmd) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code",
        "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
        "${env:ProgramFiles(x86)}\Microsoft VS Code\bin\code.cmd"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            $codePath = $p
            Write-Ok "found VS Code at $p"
            break
        }
    }
    if (-not $codePath) {
        Write-Err "VS Code not found on PATH or at standard install locations."
        Write-Warn "Install from https://code.visualstudio.com/download (tick 'Add to PATH')"
        Write-Warn "Or open VS Code manually: F1 -> 'Remote-SSH: Connect to Host' -> $VMHostAlias"
        exit 1
    }
} else {
    $codePath = $codeCmd.Source
}
# Call shim: cmd files need cmd /c on older PowerShell.
function Invoke-Code {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CodeArgs)
    if ($codePath -like "*.cmd") { & cmd /c $codePath @CodeArgs }
    else                         { & $codePath @CodeArgs }
}

$extList = Invoke-Code --list-extensions 2>$null
if ($extList -notcontains "ms-vscode-remote.remote-ssh") {
    Write-Step "Installing Remote-SSH extension..."
    Invoke-Code --install-extension ms-vscode-remote.remote-ssh --force | Out-Null
}
Write-Ok "Remote-SSH extension present"

# 6. Launch VS Code on the VM path.
$uri = "vscode-remote://ssh-remote+$VMHostAlias$ProjectPath"
Write-Ok "Opening $uri"
Invoke-Code --folder-uri $uri
