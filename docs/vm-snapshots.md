# VM snapshot workflow

Safety net for risky agent runs. ~1 min to rewind the whole VM to a known
good state.

## Before a risky run

```powershell
cd $env:USERPROFILE\genesis
vagrant snapshot save pre-agent-run
```

Vagrant creates a VirtualBox snapshot of the current VM state — disk +
memory. Takes ~10-30 seconds. Snapshots live under
`%USERPROFILE%\VirtualBox VMs\genesis-dev\Snapshots\`.

## Run the risky thing

```powershell
wsl -d Ubuntu          # or: vagrant ssh
```

Inside VM:

```bash
clawteam launch genesis-coder --goal "Refactor the auth module" --workspace --repo .
```

## If it goes sideways

```powershell
vagrant snapshot restore pre-agent-run
```

The VM rolls back — filesystem, processes, network state all as they
were. `~/.clawteam/` and `~/projects/` revert too. No side effects.

## Housekeeping

Snapshots eat disk (each is ~2-8 GB):

```powershell
vagrant snapshot list
# genesis-dev:
#   pre-agent-run
#   before-big-refactor

vagrant snapshot delete pre-agent-run
```

Keep no more than 2-3 live snapshots unless you have disk to spare.

## Combined with `git`

Snapshots are coarse (whole-VM). Git is fine (files). Use both:

1. Before risky: `git checkout -b experimental; git commit -am "checkpoint"; vagrant snapshot save pre-experiment`
2. Let agents run.
3. **Good outcome**: `git push; vagrant snapshot delete pre-experiment`.
4. **Bad outcome**: `vagrant snapshot restore pre-experiment` — includes your checkpoint branch.

## Caveat: host files

Snapshots roll back VM disk only. If your project is mounted from the
Windows host (`/home/vagrant/shared-projects` via `GENESIS_SYNC_PROJECTS`),
**those files are NOT snapshotted** — they live on the Windows NTFS, not
in the VM's VDI. Snapshot restore won't revert them.

For full-safety rollback, keep projects in `~/projects/` (inside the VM)
and use git + snapshots together.
