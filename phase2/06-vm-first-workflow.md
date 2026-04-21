# VM-first workflow — isolation + performance

## Why switch from WSL to VM

Two real pain points surfaced in phase 1:

1. **Performance.** `/mnt/c` I/O from WSL is ~10× slower than native ext4
   for the many-small-file workloads agents produce (git operations, node
   modules, uv caches, test runs). Users feel this as "ClawTeam and
   Claude are slow".
2. **Isolation.** WSL2 shares your Windows user's files. An agent with
   `Bash(rm -rf *)` latitude (or a bug in an MCP tool) can damage
   `C:\Users\you\...`. With OpenClaw running as a 24/7 daemon
   responding to channel messages, the blast radius grows.

A Vagrant VM solves both:

- VM disk is a single VDI file; agents never cross the Windows boundary.
- Projects live on the VM's ext4 disk; no `/mnt/c` penalty.
- If something goes catastrophically wrong, `vagrant destroy && vagrant up`
  rebuilds the whole sandbox in ~15 minutes and your Windows files stay
  pristine.

## VM mode is already supported — what's missing

`setup-genesis.ps1 -Mode vm` is in Phase 1. It boots an 8 GB / 4 CPU
Ubuntu 24.04 VM via Vagrant + VirtualBox, runs the same `provision.sh`,
and installs the same toolchain. **What's missing for the VM-first
workflow:**

1. **A documented and ergonomic way to get code into and out of the VM.**
   Today it's "SSH in and git clone, like any remote server" — fine for
   power users, a speedbump for day-to-day.
2. **A default project directory** the VM exposes (either via Vagrant
   synced folder or VS Code Remote-SSH) so `code .` Just Works.
3. **Credential handling**: forwarding your SSH agent and GitHub token
   into the VM so `git push` works without re-pasting PATs.
4. **VS Code Remote-SSH profile generation** — 1 command to open your
   project in the VM from Windows VS Code.
5. **Persistence + snapshots**: easy `vagrant snapshot save good-state`
   before risky agent runs, `vagrant snapshot restore` to rewind.

## Architecture

```
Windows host                                     Ubuntu VM (VirtualBox)
─────────────                                    ──────────────────────
VS Code (Remote-SSH extension)  ─── SSH ────>    sshd on port 2222
    │                                              │
    │  Edit / open folders                         ├─ /home/vagrant/projects/  (fast ext4)
    │                                              │     my-saas-app/  my-trading-bot/  ...
    │                                              │
    ├─ ollama desktop   ◄── HTTP:11434 ───         ├─ claude (uses Ollama over forwarded port)
    │  (still on host, pass-through)               ├─ clawteam (spawns Claude teams in tmux)
    │                                              ├─ openclaw (optional daemon)
    └─ `vagrant up/halt/ssh/snapshot`              └─ /vagrant (shared, small, for Genesis repo only)
                                                   
                                                   NOT mounted: nothing from C:\ unless
                                                   you explicitly configure synced_folder.
```

## Concrete plan

### Milestone 2.5 — VM-first enablement (adds to roadmap)

Target tag: `v0.2.4` (fits between 2.3 and 2.4, no dependency conflicts).

**Deliverables:**

#### 1. Vagrantfile — default project directory + sensible defaults

```ruby
# Vagrantfile (edit)
Vagrant.configure("2") do |config|
  config.vm.box = "bento/ubuntu-24.04"
  config.vm.hostname = "genesis"

  config.vm.provider "virtualbox" do |vb|
    vb.name   = "genesis-dev"
    vb.memory = ENV.fetch("GENESIS_VM_MEMORY", "8192").to_i
    vb.cpus   = ENV.fetch("GENESIS_VM_CPUS",   "4").to_i
  end

  # SSH: forward to 2222 on host
  config.vm.network "forwarded_port", guest: 22, host: 2222, id: "ssh"

  # Ollama pass-through: VM -> host :11434
  # Vagrant doesn't need this; use host.docker.internal-style approach
  # by advertising host IP as 10.0.2.2 (VirtualBox NAT default)

  # Genesis repo: synced, read-only from VM side
  config.vm.synced_folder ".", "/vagrant", mount_options: ["ro"]

  # Optional: mount a Windows projects folder into VM (user opts in)
  projects_dir = ENV["GENESIS_SYNC_PROJECTS"]
  if projects_dir && Dir.exist?(projects_dir)
    config.vm.synced_folder projects_dir, "/home/vagrant/shared-projects",
      type: "virtualbox"
  end

  # Provision
  config.vm.provision "shell", path: "provision.sh", privileged: false
end
```

**Key decisions:**

- `/vagrant` is **read-only** to stop agents from accidentally scribbling
  into your Genesis checkout on Windows.
- `GENESIS_SYNC_PROJECTS` is opt-in. Default: no Windows dirs mounted.
  Users clone fresh into `/home/vagrant/projects/` and do all work there.
- Memory/CPU overridable via env for users with bigger hosts.

#### 2. Provisioner extension — create the default project home

Inside `provision.sh`:

```bash
# Phase 4b (new) — standard project layout for VM mode
if [[ -f /etc/vagrant_box.info ]] || [[ "$USER" == "vagrant" ]]; then
  mkdir -p "$HOME/projects"
  step "created $HOME/projects (primary workspace)"
fi
```

And in Phase 9 settings.json: same as today, but for VM mode the Ollama
URL is `http://10.0.2.2:11434` (VirtualBox NAT gateway). The auto-detect
loop I added already handles this — no change needed.

#### 3. Credentials: SSH agent forwarding + GitHub

**Approach:** use Vagrant's built-in SSH agent forwarding. User's Windows
SSH agent (OpenSSH) injects keys; VM uses them for `git push`.

```ruby
# Vagrantfile addition
config.ssh.forward_agent = true
```

Post-provision instructions in the wizard output:

```
Credentials inside the VM:
  # One-time — copy your GitHub PAT if you use HTTPS clone:
  vagrant ssh
  gh auth login
  # OR use SSH (already forwarded):
  ssh -T git@github.com     # should succeed via your host keys
```

#### 4. VS Code Remote-SSH helper

Most friction today: users don't know they can VS-Code the VM. Add a
`scripts/open-vm-in-vscode.ps1`:

```powershell
# scripts/open-vm-in-vscode.ps1
param([string]$ProjectPath = "/home/vagrant/projects")

# Ensure vagrant's ssh config is exported for VS Code to consume
$vm = "genesis-dev"
$sshConfig = vagrant ssh-config
$sshConfig | Out-File -FilePath "$env:USERPROFILE\.ssh\config.d\genesis" -Encoding ASCII -Force

# VS Code Remote-SSH URI
$uri = "vscode-remote://ssh-remote+default$ProjectPath"
code --folder-uri $uri
```

Exposed as a wizard post-install hint:

```powershell
.\scripts\open-vm-in-vscode.ps1                         # opens ~/projects
.\scripts\open-vm-in-vscode.ps1 /home/vagrant/projects/my-app
```

VS Code's Remote-SSH extension must be installed (we'll prompt if not,
`code --install-extension ms-vscode-remote.remote-ssh`).

#### 5. Snapshot workflow — `vagrant snapshot`

Document in `docs/vm-snapshots.md`:

```bash
# Before a risky multi-agent run:
vagrant snapshot save pre-agent-run

# Run the team...
clawteam launch genesis-coder --goal "refactor auth module"

# If it goes sideways:
vagrant snapshot restore pre-agent-run       # <1 min

# Housekeeping (snapshots eat disk):
vagrant snapshot list
vagrant snapshot delete pre-agent-run
```

#### 6. Wizard flag: `-VMFirst` (convenience)

Today: `-Mode vm` boots the VM and provisions. Adds to that, `-VMFirst`
also:

- Opens the ssh-config for Remote-SSH auto-population.
- Prints post-install next-steps tailored for "all work happens in VM".
- Writes a `~/.genesis/vm-config.json` recording VM IP/port for the
  helper script.

```powershell
.\setup\setup-genesis.ps1 -VMFirst
# Implies -Mode vm + VS Code hints + ssh-config export
```

### Capacity planning

Default VM: 8 GB RAM, 4 CPUs, ~30 GB dynamic disk.

For agent work that's plenty. Tuning knobs:

```powershell
# 16 GB host with room to spare
$env:GENESIS_VM_MEMORY = "12288"
$env:GENESIS_VM_CPUS   = "6"
.\setup\setup-genesis.ps1 -Mode vm
```

Disk grows on demand up to ~60 GB (VirtualBox default). No preallocation
cost.

### Comparison: WSL vs VM for this use case

|                                   | WSL2 (phase 1 default) | Vagrant VM (VM-first) |
|-----------------------------------|------------------------|-----------------------|
| `~/projects` I/O                  | ext4 — fast            | ext4 — fast           |
| `/mnt/c` I/O                      | slow                   | **not mounted by default** |
| Boot time after shutdown          | <5 s                   | 30–60 s               |
| RAM overhead                      | dynamic (minimal when idle) | fixed allocation (8 GB) |
| Isolation from Windows files      | **shared**              | **hard boundary**     |
| Snapshots                         | no                     | **yes, `vagrant snapshot`** |
| Reset-the-sandbox speed           | manual cleanup         | `vagrant destroy && up` ~15 min |
| Works with BitLocker / Defender   | yes                    | yes                   |
| GPU passthrough for local models  | native                 | limited (VirtualBox)  |

**User is on cloud models (Ollama Cloud), so GPU is a non-factor.**

### Trade-off to flag

- VM is **always-on resource overhead**: 8 GB RAM fixed while running.
  If user has 16 GB host, that's half the machine. Mitigate with
  `vagrant halt` at end of day (like closing an IDE).
- `vagrant up` is slower than `wsl -d Ubuntu` — ~45 s vs instant. Mitigate
  by leaving the VM running all day.

### Migration path for current user

You (Abdul) are already on WSL with a working install. Path:

1. Keep the WSL install as a fallback (don't uninstall).
2. Run `.\setup\setup-genesis.ps1 -VMFirst`. Vagrant downloads the box
   (~1 GB), boots, provisions. ~20 min first time.
3. Clone your projects into `/home/vagrant/projects/` via `git clone`
   (use the forwarded SSH agent — no PAT copy-paste).
4. VS Code: `.\scripts\open-vm-in-vscode.ps1` opens the VM in Remote-SSH
   mode. Feels identical to editing local files.
5. When confident, `wsl --unregister Ubuntu` to reclaim space (optional).

## Acceptance criteria

- [ ] `setup-genesis.ps1 -VMFirst` boots VM and provisions in one run.
- [ ] VS Code Remote-SSH opens `/home/vagrant/projects` with a single
      script invocation.
- [ ] `git push` from inside the VM works without typing credentials
      (SSH agent forwarding proven).
- [ ] `vagrant snapshot save/restore/delete` documented and tested.
- [ ] `claude` inside the VM connects to Windows-host Ollama via
      `http://10.0.2.2:11434` (auto-detected by provision.sh).
- [ ] `clawteam launch` inside the VM runs at native ext4 speed (no
      `/mnt/c` involvement).

## Where this fits in the roadmap

Updated sequence:

| Milestone | Tag | Note |
|---|---|---|
| 2.0 — Catalog foundation | `v0.2.1` | unchanged |
| 2.1 — `clawteam` skill + `genesis-coder` | `v0.2.2` | unchanged |
| 2.2 — Vibe-Trading MCP + `finance-desk` | `v0.2.3` | unchanged |
| **2.5 — VM-first enablement** (NEW) | **`v0.2.4`** | inserted |
| 2.3 — OpenClaw daemon | `v0.2.5-rc1` | renumbered, daemon only makes sense in a VM for real-world 24/7 use |
| 2.4 — Catalog promoted, `v0.3.0` | `v0.3.0` | unchanged |

Rationale for moving the daemon **after** VM-first: a 24/7 daemon reaching
Telegram/Discord is much safer in a VM than in WSL where it has your
whole Windows filesystem in reach. Pairing the daemon milestone with
VM-first lets us recommend VM as the default for daemon users.
