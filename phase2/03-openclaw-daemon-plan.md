# OpenClaw daemon — optional 24/7 agent

## Goal

Turn OpenClaw into a background systemd user service inside WSL2 that:

- Stays running after you close PowerShell.
- Listens on one or more channels you already use (Telegram, Discord,
  Signal, Matrix, Slack).
- Receives DMs from **you only** (pairing-based auth).
- Has the `clawteam` skill installed so it can spawn teams in response to
  your messages.
- Shares the same `~/.clawteam/` state as your interactive sessions — so
  you can DM it "spin up a code-review team on my-repo" and later watch
  the team via `clawteam board` from a regular WSL shell.

## What OpenClaw onboarding actually does

Upstream command:

```bash
openclaw onboard --install-daemon
```

This:

1. Writes `~/.openclaw/workspace/config.yaml` with default channel settings.
2. Installs `~/.config/systemd/user/openclaw.service` pointing at
   `openclaw gateway start`.
3. Enables `systemd --user` if not already running.
4. Installs the bundled ClawTeam skill into
   `~/.openclaw/workspace/skills/clawteam/SKILL.md`.
5. Writes `exec-approvals.json` with `clawteam` allowlisted.

## WSL2 gotchas

### systemd inside WSL

Ubuntu 24.04 WSL **supports systemd** when enabled in `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

The wizard should ensure this once:

```bash
if ! grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null; then
  $SUDO tee -a /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
  warn "systemd enabled; run 'wsl --shutdown' from Windows then re-enter WSL"
fi
```

User must then run `wsl --shutdown` from Windows PowerShell and re-enter —
this restarts the distro with PID 1 as systemd. Until they do, `systemctl
--user` won't work.

### Daemon persistence

WSL2 terminates the distro when no processes are running and no terminal
is open. Two options:

1. **Keep a terminal open** (fine for dev; user closes machine at night).
2. **Enable WSL distro as a Windows autostart task** — a `schtasks.exe`
   entry that runs `wsl -d Ubuntu -u user -- true` on login, keeping the
   distro warm. Good for true 24/7.

The wizard will offer option 2 behind a `-OpenClawDaemon` flag.

## Channel setup

OpenClaw supports Telegram, Discord, Signal, Slack, Matrix, iMessage (Mac
only), WhatsApp, WeChat, Teams. The pairing model:

1. You tell OpenClaw which bot/account to use (via channel config).
2. OpenClaw prints a pairing code or QR.
3. You scan/enter it from your personal Telegram (etc.) account.
4. OpenClaw records your account as the authorized sender. Unknown senders
   are auto-blocked until you approve.

The wizard can't automate pairing — it's inherently interactive (the code
must arrive on your phone). What the wizard **can** do:

- Install the daemon.
- Write a template `config.yaml` with your preferred channels enabled
  (the wizard asks "Telegram? Discord?…").
- Print the exact `openclaw channel pair telegram` commands you need to
  run next.

## Proposed Genesis wizard additions

New flag: `-OpenClawDaemon`. When set:

1. After Phase 5a (OpenClaw install), run:

   ```bash
   openclaw onboard --install-daemon --non-interactive
   ```

2. Ensure `/etc/wsl.conf` has `systemd=true`; warn if not yet applied.

3. Emit post-install next-steps:

   ```text
   Pairing (run inside WSL):
     openclaw channel add telegram
     openclaw channel pair telegram
     # follow prompts; scan code with your phone

   Verify:
     systemctl --user status openclaw
     openclaw channel list

   Test from your phone:
     DM your bot: "clawteam team list"
     → should reply with the current teams.
   ```

## Security stance

- Daemon only responds to **paired** senders. Enforced by OpenClaw.
- `clawteam` is on the allowlist but **no other binary is by default.**
  Users who want broader latitude (e.g., `bash`, `npm`) edit
  `exec-approvals.json` themselves — explicit opt-in.
- Host-side files are reachable (`/mnt/c/...`) so a compromised daemon can
  in principle damage Windows files. If that's a concern, use `-Mode vm`.

## Not in scope for phase 2

- Multi-user / multi-tenant OpenClaw.
- Public-facing webhook URLs.
- Auto-pairing via automation (fundamentally incompatible with OpenClaw's
  security model).

## Acceptance criteria

- [ ] `-OpenClawDaemon` flag installs the service in one wizard run.
- [ ] `systemctl --user is-active openclaw` returns `active` after boot.
- [ ] ClawTeam skill is in `~/.openclaw/workspace/skills/clawteam/`.
- [ ] Surviving a `wsl --shutdown` and re-entering WSL keeps the daemon
      running (provided the user enabled the autostart task).
- [ ] Pairing flow documented in `docs/openclaw-daemon.md`.
