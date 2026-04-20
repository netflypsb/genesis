#Requires -Version 5.1
# Genesis bootstrap - one-liner entry point.
# Usage:
#   iwr https://raw.githubusercontent.com/netflypsb/genesis/main/setup/bootstrap.ps1 | iex

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoUrl  = "https://github.com/netflypsb/genesis.git"
$TargetDir = Join-Path $env:USERPROFILE "genesis"

function Write-Header {
    param([string]$T)
    Write-Host ""; Write-Host "  $T" -ForegroundColor Cyan
    Write-Host "  $('=' * $T.Length)" -ForegroundColor DarkCyan
}

Write-Header "Genesis Bootstrap"
Write-Host "  Cloning $RepoUrl -> $TargetDir" -ForegroundColor Gray

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  git not found. Install Git for Windows first: https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

if (Test-Path $TargetDir) {
    Write-Host "  Existing clone found. Pulling latest..." -ForegroundColor Yellow
    git -C $TargetDir pull --ff-only
} else {
    git clone $RepoUrl $TargetDir
}

$wizard = Join-Path $TargetDir "setup\setup-clawteam-wsl.ps1"
Write-Host ""
Write-Host "  Launching wizard: $wizard" -ForegroundColor Green
& $wizard
