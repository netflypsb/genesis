# OpenClaw Gateway — 24/7 remote team launching

The OpenClaw gateway daemon lets you **DM your Genesis sandbox** (from
your phone, laptop, any device with Telegram/Discord/Slack) and have it
spawn ClawTeam teams remotely. You close your laptop, the agents keep
working, and you check results from anywhere.

This is **opt-in**. Default Genesis installs don't include it.

> ⚠️ **Known limitation (April 2026)** — `openclaw onboard` inside a Vagrant
> VM sometimes fails its Ollama reachability probe even when the endpoint
> is demonstrably reachable with `curl` (Node.js fetch quirk with Ollama
> Cloud over VirtualBox NAT). When this happens, Genesis still installs
> everything else correctly; only `gateway: inactive` in the summary. You
> can skip the daemon and use Genesis normally via `vagrant ssh` → `claude`
> / `clawteam` launch. Tracking this as a follow-up; the workaround is to
> run `openclaw onboard` interactively from inside `vagrant ssh` (it uses
> a different probe path in interactive mode).

## Quick install (VM)

```powershell
cd $env:USERPROFILE\genesis
.\setup\setup-genesis.ps1 -VMFirst -OpenClawDaemon
```

The wizard:

1. Runs `openclaw onboard --install-daemon --non-interactive` inside the VM.
2. Writes `~/.openclaw/openclaw.json` with a sensible default config.
3. Installs `~/.config/systemd/user/openclaw-gateway.service`.
4. Runs `loginctl enable-linger vagrant` so the daemon survives logout.
5. Starts the service and probes `127.0.0.1:18789` for liveness.

The summary line shows `gateway: active` when it worked.

### Verify

```powershell
vagrant ssh
systemctl --user status openclaw-gateway           # should be: active (running)
curl -s http://127.0.0.1:18789/health              # some JSON response
openclaw gateway status                            # openclaw's own check
```

## Pairing with Telegram

The wizard deliberately does not automate this — pairing requires your
phone, which no script can drive for you.

### 1. Create a Telegram bot

On your phone:

1. Open Telegram, search for `@BotFather`, send `/newbot`.
2. Give it a display name and a `@username_bot`.
3. BotFather replies with an **HTTP API token** like `123456:ABCdef...`.
   Copy it. Treat it like a password — anyone with this token can
   impersonate your bot.

Recommended `@BotFather` settings (send these in the chat with BotFather):

```
/setprivacy        # disable, so the bot can see group messages
/setjoingroups     # enable if you want the bot in group chats
```

### 2. Register the token with the gateway

Inside the VM:

```bash
vagrant ssh
export TELEGRAM_BOT_TOKEN=123456:ABCdef...
openclaw channels login telegram         # takes the token from the env var
openclaw gateway restart                  # pick up the new channel config
```

### 3. Pair your Telegram account

Still inside the VM:

```bash
openclaw pairing list telegram            # shows pending pairing codes
```

Now **DM your bot from your personal Telegram account**. The bot replies
with a pairing code (6 digits). Approve it from the VM:

```bash
openclaw pairing approve telegram 123456
```

The gateway now trusts your Telegram user ID. Any other sender is
auto-rejected (DM policy defaults to `pairing`).

### 4. Test it

From your phone, DM the bot:

```
clawteam team list
```

You should get a reply listing the current teams (empty if you haven't
launched any yet).

To actually run a team:

```
clawteam launch genesis-coder --goal "Write a Python CLI that prints the first 10 primes with pytest tests" --workspace --repo /home/vagrant/projects/test-run
```

The bot confirms, and a tmux session with the team starts inside the VM.
Check progress:

```
clawteam board show <team-id>
```

## Daily operations

All commands run inside the VM (`vagrant ssh`):

| Task | Command |
|---|---|
| Status | `systemctl --user status openclaw-gateway` |
| Restart | `systemctl --user restart openclaw-gateway` |
| Stop | `systemctl --user stop openclaw-gateway` |
| Live logs | `journalctl --user -u openclaw-gateway -f` |
| Last 100 log lines | `journalctl --user -u openclaw-gateway -n 100` |
| Config file | `cat ~/.openclaw/openclaw.json` |
| Edit config | `nano ~/.openclaw/openclaw.json && systemctl --user restart openclaw-gateway` |
| List channels | `openclaw channels list` |
| Dashboard | `openclaw dashboard` (opens Control UI) |

### Survival across `vagrant halt` / reboot

Because the wizard ran `loginctl enable-linger vagrant`, the user's
systemd session persists across logouts. Combined with the systemd unit's
`WantedBy=default.target`, the gateway comes back automatically when the
VM boots:

```powershell
vagrant halt
vagrant up              # gateway comes back within ~30 seconds of boot
```

No need to run the wizard again. If you want to re-provision the daemon
from scratch (e.g. after a major upgrade), run:

```powershell
.\setup\setup-genesis.ps1 -VMFirst -OpenClawDaemon
```

Idempotent — safe to re-run.

## Security model

- **DM policy `pairing`** (default): only pre-approved Telegram user IDs
  can DM the bot. Everyone else is silently ignored.
- **Gateway bound to `127.0.0.1:18789`**: not exposed to your LAN or
  Windows host. External messages only arrive via the Telegram cloud.
- **Exec allowlist**: the daemon spawns commands only from the allowlist
  in `~/.openclaw/exec-approvals.json`. Genesis pre-approves `clawteam`
  and `tmux`. You can add more with:
  ```bash
  openclaw approvals allowlist add --agent "*" "*/git"
  ```
  Don't allowlist `bash` or `sh` unless you understand you're giving
  Telegram DMs root-equivalent power inside the VM.
- **VM isolation**: a compromised gateway can damage the VM but cannot
  reach Windows files (unless you opted in with `-SyncProjects`).

## Troubleshooting

### `gateway: inactive` in summary

```bash
systemctl --user status openclaw-gateway
journalctl --user -u openclaw-gateway -n 50
```

Most common causes:

| Symptom | Fix |
|---|---|
| Port 18789 in use | Something else bound the port: `ss -lntp \| grep 18789`. Stop the other process or change `gateway.port` in `~/.openclaw/openclaw.json`. |
| No API key configured | Provisioner uses `--auth-choice ollama`. Ensure `~/.claude/settings.json` has `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` set (check with `setup-provider.ps1`). |
| Systemd doesn't see the unit | `systemctl --user daemon-reload` then retry `enable --now`. |

### Bot never replies

```bash
openclaw channels list                    # is telegram showing 'enabled'?
openclaw pairing list telegram            # any pending pairing codes?
journalctl --user -u openclaw-gateway -f  # watch while you DM the bot
```

If the logs show no incoming message, check on Telegram:
- Did you `/start` the bot? (Telegram requires this handshake first.)
- Did BotFather `/setprivacy` disable work? (Bot needs to see messages.)

### Pairing code arrives but approve fails

The code expires after ~5 minutes. List again:

```bash
openclaw pairing list telegram
```

and re-DM the bot for a fresh code.

## Uninstall / disable

```bash
systemctl --user disable --now openclaw-gateway
rm ~/.config/systemd/user/openclaw-gateway.service
systemctl --user daemon-reload
sudo loginctl disable-linger vagrant      # optional; removes the linger
```

Or just destroy the VM — `vagrant destroy -f` wipes everything.

## Related

- Upstream docs: https://docs.openclaw.ai/start/getting-started
- Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- Security mode: https://docs.openclaw.ai/help/security
- Genesis M2.3 plan: `phase2/03-openclaw-daemon-plan.md`
