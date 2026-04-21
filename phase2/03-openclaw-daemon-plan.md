# Milestone 2.3 — OpenClaw daemon (24/7 gateway)

## Goal

Turn the sandbox (VM preferred, WSL possible) into a **24/7 OpenClaw gateway**
that:

- Starts automatically on VM boot / WSL login via `systemctl --user`.
- Keeps running after the user logs out (via `loginctl enable-linger`).
- Listens on port `18789` inside the sandbox.
- Optionally pairs with a personal Telegram bot (or Discord, Slack, etc.)
  so you can DM the bot and have it spawn `clawteam` teams remotely.
- Has the `clawteam` skill pre-installed in the OpenClaw workspace so
  DMs like "spin up a code-review team on repo X" actually work.

## Real OpenClaw architecture (verified against docs.openclaw.ai, Apr 2026)

- **Config path**: `~/.openclaw/openclaw.json` (JSON, not YAML)
- **Gateway port**: 18789
- **Systemd unit**: `~/.config/systemd/user/openclaw-gateway.service`
  (installed by `openclaw onboard --install-daemon`)
- **Linger**: `loginctl enable-linger <user>` so service survives logout
- **CLI entry**: `openclaw onboard --install-daemon --non-interactive`
  supports `--auth-choice`, `--skip-*`, `--workspace`, API-key flags, etc.
- **Channel config**: `channels.telegram.botToken`, `channels.telegram.dmPolicy: "pairing"`
- **Pairing**: inherently interactive (requires the user's phone), so the
  wizard cannot automate it. We install the daemon + print next-steps.

## Why VM is now the recommended backend for the daemon

Previous plan was WSL-first and fretted about `systemd=true` in
`/etc/wsl.conf`, `wsl --shutdown` dance, and Windows autostart tasks.
Since **M2.5 shipped VM-first in v0.2.2**:

- Ubuntu 24.04 VM has systemd as PID 1 natively — zero config.
- `vagrant up` brings the whole daemon back automatically the next day.
- No Windows autostart task needed; VM survives until explicitly halted.
- `loginctl enable-linger vagrant` makes the gateway survive even if the
  user `vagrant ssh` sessions all close.

WSL remains supported but requires the user to pre-configure
`/etc/wsl.conf` with `[boot] systemd=true` themselves.

## Scope for this milestone

### In scope

1. New wizard flag `-OpenClawDaemon` (forwards `GENESIS_OPENCLAW_DAEMON=1`).
2. New `provision.sh` Phase 5d — when flag is set, run:
   ```bash
   openclaw onboard \
     --install-daemon \
     --non-interactive \
     --auth-choice ollama \
     --workspace ~/.openclaw/workspace \
     --skip-channels --skip-search --skip-ui --skip-health \
     --json
   loginctl enable-linger "$USER"
   systemctl --user daemon-reload
   systemctl --user enable --now openclaw-gateway.service
   ```
3. Phase 8 (skills) already installs the `clawteam` skill into
   `~/.openclaw/workspace/skills/clawteam/` via the catalog's
   `also_install_to` field — no change needed, just verify order: daemon
   phase must come BEFORE skills phase so the workspace dir exists.
4. Summary output shows `gateway:  active|inactive` line.
5. New `docs/openclaw-daemon.md` with:
   - What you get, what it costs
   - Prerequisites (bot token from BotFather)
   - Step-by-step Telegram pairing walkthrough
   - Daily commands (`openclaw gateway status|restart|logs`)
   - Troubleshooting (linger, port 18789, firewall)
6. README: short "Remote-control via DM (optional)" section linking to
   the doc.

### Out of scope (intentional for M2.3)

- Automating Telegram pairing (requires phone; user-interactive by design).
- Writing the bot token into config — user does this post-wizard since
  creating the bot with @BotFather is also manual.
- Multi-channel setup in one run (user enables channels one at a time).
- Port forwarding from host Windows → VM for external access (NAT means
  18789 is VM-internal; external access goes through the Telegram cloud,
  which is the whole point).
- Discord/Slack/Matrix pairing walkthroughs (follow-up milestone).

## Security stance

- Daemon binds `127.0.0.1:18789` by default — not exposed to the host
  network.
- DM policy defaults to `pairing` — unknown senders rejected until user
  approves via `openclaw pairing approve telegram <CODE>`.
- The `clawteam` skill is pre-allowlisted in `exec-approvals.json` so
  agent-triggered `clawteam launch ...` doesn't stall on approval
  prompts. No other binary is allowlisted.
- A compromised daemon inside the VM cannot reach Windows files
  directly (VM is NAT-isolated) unless the user opted into
  `/home/vagrant/shared-projects` via `-SyncProjects`.

## Acceptance criteria

- [ ] `.\setup\setup-genesis.ps1 -VMFirst -OpenClawDaemon` completes
      without user interaction (after the initial bootstrap).
- [ ] `vagrant ssh -c 'systemctl --user is-active openclaw-gateway'`
      returns `active`.
- [ ] `vagrant ssh -c 'curl -s http://127.0.0.1:18789/health'` returns
      a valid response.
- [ ] `vagrant halt && vagrant up` brings the gateway back
      automatically (systemd auto-start + linger).
- [ ] Pairing walkthrough in `docs/openclaw-daemon.md` is end-to-end
      reproducible (ideal: independently verified by a second user on
      their own Telegram bot).
- [ ] `-OpenClawDaemon` is strictly opt-in; default installs show no
      behavior change.

## Follow-up milestones (not M2.3)

- **M2.3.1** — Discord/Slack/Matrix pairing walkthroughs.
- **M2.3.2** — Host-side Windows shortcut that DMs the bot on a hotkey.
- **M2.4** — Catalog promotion: clean v0.3.0 release.
