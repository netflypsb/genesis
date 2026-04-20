# Troubleshooting

## `claude: command not found` after install

PATH hasn't refreshed. Run:

```bash
exec bash -l
```

Or close and reopen the WSL terminal.

## `clawteam` not on PATH

The wizard creates `~/.local/bin/clawteam` and adds `~/.local/bin` to PATH in `~/.bashrc`. After install:

```bash
source ~/.bashrc
clawteam --version
```

If still missing, fall back to `python3 -m clawteam ...`.

## MCP server not showing in `claude mcp list`

1. Check `~/.claude/settings.json` has a valid `mcpServers` block.
2. Verify the runtime binary works:
   ```bash
   npx -y @playwright/mcp@latest --help
   uvx mcp-server-fetch --help
   uvx mcp-server-git --help
   ```
3. Restart Claude Code session.

## Playwright MCP: `Executable doesn't exist at .../chromium`

Re-run the post-install:

```bash
npx -y playwright install --with-deps chromium
```

## Ollama cloud models not responding

- Is the Windows Ollama desktop app running? (check system tray)
- Are you signed in? (open the app, sign in once)
- Does `curl http://localhost:11434/api/tags` from inside WSL return JSON? If not, see `docs/wsl-networking.md`.

## WSL localhost doesn't reach Windows

Mirrored networking isn't enabled. Run the wizard again and accept the Phase 0 prompt, or manually add to `%UserProfile%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then `wsl --shutdown`.

## Re-running the wizard changes things I don't want changed

The wizard is idempotent — it reads existing `~/.claude/settings.json`, merges new keys, and backs up the old copy to `~/.claude/settings.json.bak`. Restore with:

```bash
cp ~/.claude/settings.json.bak ~/.claude/settings.json
```
