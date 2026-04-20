# Genesis - shared PowerShell helpers
# Dot-source this file: . "$PSScriptRoot\lib\common.ps1"

Set-StrictMode -Version Latest

# -- Output helpers ------------------------------------------------------------
function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "  $('=' * $Text.Length)" -ForegroundColor DarkCyan
}
function Write-Step  { param([string]$T) Write-Host ""; Write-Host "  > $T" -ForegroundColor Yellow }
function Write-Ok    { param([string]$T) Write-Host "  OK  $T" -ForegroundColor Green }
function Write-Info  { param([string]$T) Write-Host "  $T"      -ForegroundColor Gray }
function Write-Warn  { param([string]$T) Write-Host "  !! $T"   -ForegroundColor DarkYellow }
function Write-Fail  { param([string]$T) Write-Host "  XX $T"   -ForegroundColor Red }
function Write-Check {
    param([string]$Label, [bool]$Pass, [string]$Detail = "")
    $suffix = if ($Detail) { " -- $Detail" } else { "" }
    if ($Pass) { Write-Host "  [PASS] $Label$suffix" -ForegroundColor Green }
    else       { Write-Host "  [FAIL] $Label$suffix" -ForegroundColor Red }
}

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
        } else { $val = Read-Host }
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

# -- JSON merge (hashtable-based, preserves existing keys) ---------------------
function ConvertTo-Hashtable {
    param($InputObject)
    if ($null -eq $InputObject) { return @{} }
    if ($InputObject -is [hashtable]) { return $InputObject }
    $h = @{}
    if ($InputObject -is [pscustomobject]) {
        foreach ($p in $InputObject.PSObject.Properties) {
            if ($p.Value -is [pscustomobject]) { $h[$p.Name] = ConvertTo-Hashtable $p.Value }
            else { $h[$p.Name] = $p.Value }
        }
    }
    return $h
}

function Merge-Hashtable {
    param([hashtable]$Base, [hashtable]$Overlay)
    foreach ($k in $Overlay.Keys) {
        if ($Base.ContainsKey($k) -and $Base[$k] -is [hashtable] -and $Overlay[$k] -is [hashtable]) {
            $Base[$k] = Merge-Hashtable $Base[$k] $Overlay[$k]
        } else {
            $Base[$k] = $Overlay[$k]
        }
    }
    return $Base
}
