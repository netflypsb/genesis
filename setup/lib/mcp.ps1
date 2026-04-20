# Genesis - MCP server helpers
# Requires common.ps1 and wsl.ps1 to be dot-sourced first.

function Get-McpRegistry {
    param([string]$RegistryPath)
    if (-not (Test-Path $RegistryPath)) {
        throw "MCP registry not found at $RegistryPath"
    }
    $raw = Get-Content $RegistryPath -Raw
    $obj = $raw | ConvertFrom-Json
    return ConvertTo-Hashtable $obj
}

function Test-McpRequirements {
    # Returns @{ ok=$bool; missing=@('node','uv',...) }
    param([string[]]$Requires)
    $missing = @()
    foreach ($r in $Requires) {
        if (-not (Test-WslCommand $r)) { $missing += $r }
    }
    return @{ ok = ($missing.Count -eq 0); missing = $missing }
}

function Invoke-McpPostInstall {
    param([string[]]$PostCommands)
    if (-not $PostCommands) { return }
    foreach ($cmd in $PostCommands) {
        Write-Step "Running post-install: $cmd"
        wsl bash -lc "$cmd" 2>&1 | ForEach-Object { Write-Info "  $_" }
    }
}

function Build-McpServersBlock {
    # Given a registry and a list of selected ids, build the mcpServers hashtable.
    param([hashtable]$Registry, [string[]]$SelectedIds)
    $block = @{}
    foreach ($id in $SelectedIds) {
        if (-not $Registry.ContainsKey($id)) {
            Write-Warn "MCP id '$id' not in registry, skipping."
            continue
        }
        $entry = $Registry[$id]
        $srv = @{ command = $entry.command }
        if ($entry.ContainsKey('args') -and $entry.args) { $srv['args'] = @($entry.args) }
        if ($entry.ContainsKey('env')  -and $entry.env)  { $srv['env']  = $entry.env }
        $block[$id] = $srv
    }
    return $block
}
