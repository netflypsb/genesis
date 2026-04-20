# Genesis - WSL helpers

# Script-scope variable holding distro arg fragment, e.g. @('-d','Ubuntu') or @().
# Set by Select-WslDistro; consumed by Invoke-WslCmd et al.
$script:WslDistroArgs = @()
$script:WslDistroName = ""

function Get-WslDistroList {
    # Returns array of installed distro names (excluding the header). Handles wsl's UTF-16 output.
    $prev = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
        $raw = & wsl.exe -l -q 2>$null
    } finally {
        [Console]::OutputEncoding = $prev
    }
    if (-not $raw) { return @() }
    return @($raw -split "`r?`n" | ForEach-Object { ($_ -replace '\x00','').Trim() } | Where-Object { $_ })
}

function Select-WslDistro {
    # Picks a real distro (skips docker-desktop*). Sets $script:WslDistroArgs and returns name.
    param([string]$Preferred = "")
    $distros = Get-WslDistroList
    if ($distros.Count -eq 0) {
        throw "No WSL distros are installed. Run: wsl --install -d Ubuntu"
    }
    $usable = @($distros | Where-Object { $_ -notmatch '^docker-desktop' })
    if ($usable.Count -eq 0) {
        throw "Only docker-desktop distros are installed. Install a real distro: wsl --install -d Ubuntu"
    }
    if ($Preferred -and ($usable -contains $Preferred)) {
        $chosen = $Preferred
    } elseif ($usable.Count -eq 1) {
        $chosen = $usable[0]
    } else {
        # Prefer Ubuntu if present, else first
        $ub = @($usable | Where-Object { $_ -match '^Ubuntu' })
        if ($ub.Count -gt 0) { $chosen = $ub[0] } else { $chosen = $usable[0] }
    }
    $script:WslDistroName = $chosen
    $script:WslDistroArgs = @('-d', $chosen)
    return $chosen
}

function Invoke-WslCmd {
    param([string]$Command)
    $distroArgs = $script:WslDistroArgs
    if (-not $distroArgs) { $distroArgs = @() }
    return (& wsl.exe @distroArgs -- bash -c $Command 2>&1)
}

function Invoke-WslLogin {
    # Runs $Command in a login shell (bash -lc) on the selected distro, streaming output.
    param([string]$Command)
    $distroArgs = $script:WslDistroArgs
    if (-not $distroArgs) { $distroArgs = @() }
    return (& wsl.exe @distroArgs -- bash -lc $Command 2>&1)
}

function Get-WslDistroArgsString {
    # For use with Start-Process: returns "-d <name>" or "" to embed in argument list.
    if ($script:WslDistroName) { return @('-d', $script:WslDistroName) }
    return @()
}

function Test-WslCommand {
    param([string]$Cmd)
    $r = Invoke-WslCmd "command -v $Cmd >/dev/null 2>&1 && echo YES || echo NO"
    return ($r -match "YES")
}

function Get-WslVersion {
    param([string]$Cmd, [string]$Flag = "--version")
    try {
        $v = Invoke-WslCmd "$Cmd $Flag 2>&1 | head -1"
        return ($v | Out-String).Trim()
    } catch { return "" }
}

function Test-WslAvailable {
    try {
        $null = wsl --status 2>&1
        return $true
    } catch { return $false }
}

function Get-WslNetworkingMode {
    # Returns 'mirrored', 'nat', or 'unknown'
    $cfg = Join-Path $env:USERPROFILE ".wslconfig"
    if (Test-Path $cfg) {
        $content = Get-Content $cfg -Raw
        if ($content -match '(?im)^\s*networkingMode\s*=\s*mirrored') { return 'mirrored' }
        if ($content -match '(?im)^\s*networkingMode\s*=\s*nat')       { return 'nat' }
    }
    return 'unknown'
}

function Enable-WslMirroredNetworking {
    # Idempotent: appends/updates .wslconfig to set networkingMode=mirrored
    $cfg = Join-Path $env:USERPROFILE ".wslconfig"
    if (-not (Test-Path $cfg)) {
        Set-Content -Path $cfg -Value "[wsl2]`nnetworkingMode=mirrored`n" -Encoding ASCII
        return $true
    }
    $content = Get-Content $cfg -Raw
    if ($content -match '(?im)^\s*networkingMode\s*=') {
        $new = [regex]::Replace($content, '(?im)^\s*networkingMode\s*=.*$', 'networkingMode=mirrored')
        Set-Content -Path $cfg -Value $new -Encoding ASCII
    } elseif ($content -match '(?im)^\s*\[wsl2\]') {
        $new = [regex]::Replace($content, '(?im)^\s*\[wsl2\]\s*$', "[wsl2]`nnetworkingMode=mirrored")
        Set-Content -Path $cfg -Value $new -Encoding ASCII
    } else {
        Add-Content -Path $cfg -Value "`n[wsl2]`nnetworkingMode=mirrored`n"
    }
    return $true
}

function Get-WslHostForOllama {
    # Returns the URL from inside WSL that reaches the Windows host Ollama daemon.
    $mode = Get-WslNetworkingMode
    if ($mode -eq 'mirrored') { return 'http://localhost:11434' }
    return 'http://host.docker.internal:11434'
}

function Write-WslFile {
    # Writes $Content to $WslPath (e.g. ~/.claude/settings.json) via a temp file
    # on Windows + wslpath conversion, avoiding bash quoting hazards.
    param([string]$WslPath, [string]$Content)
    $tmp = New-TemporaryFile
    try {
        [System.IO.File]::WriteAllText($tmp.FullName, $Content, [System.Text.UTF8Encoding]::new($false))
        $winPath = $tmp.FullName -replace '\\','/'
        $winPathEscaped = $winPath -replace "'","'\\''"
        $wslSrc = Invoke-WslCmd "wslpath '$winPathEscaped'"
        $wslSrc = ($wslSrc | Out-String).Trim()
        $dir = $WslPath -replace '/[^/]+$',''
        if (-not $dir) { $dir = "." }
        Invoke-WslCmd "mkdir -p $dir && cp '$wslSrc' $WslPath" | Out-Null
    } finally {
        Remove-Item $tmp.FullName -Force -ErrorAction SilentlyContinue
    }
}

function Read-WslFile {
    param([string]$WslPath)
    $out = Invoke-WslCmd "[ -f $WslPath ] && cat $WslPath || true"
    return ($out | Out-String)
}
