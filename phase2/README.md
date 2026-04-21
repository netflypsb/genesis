# Genesis Phase 2 — planning & docs

Phase 1 (shipped as `v0.2.0`) set up the WSL2/VM sandbox with Claude Code,
OpenClaw, ClawTeam, 5 user-scope MCPs, and 6 bundled skills.

Phase 2 turns Genesis from an installer into a **pluggable catalog** that your
agent swarm can grow with: custom ClawTeam team templates, the `clawteam` skill
for agents to self-orchestrate, and an optional OpenClaw daemon with a
messaging-channel bridge.

## Read in order

1. [`00-faq-answers.md`](00-faq-answers.md) — direct answers to the questions
   that motivated this phase (first-run vs day-to-day, lead-agent concept, WSL
   vs Windows Claude Code, disk access, Vibe-Trading).
2. [`01-architecture.md`](01-architecture.md) — how Claude Code, OpenClaw, and
   ClawTeam compose; lead-agent rules; skill layering.
3. [`02-custom-templates-plan.md`](02-custom-templates-plan.md) — technical
   plan for adding `genesis-coder` (from our `agents/` folder) and a
   Vibe-Trading integration.
4. [`03-openclaw-daemon-plan.md`](03-openclaw-daemon-plan.md) — optional
   phase: OpenClaw as a persistent daemon reachable via Telegram/Discord.
5. [`04-repo-reorg.md`](04-repo-reorg.md) — how to restructure the Genesis
   repo so teams/skills/MCPs are all pluggable catalog entries the wizard can
   install selectively.
6. [`05-roadmap.md`](05-roadmap.md) — phased roadmap with checkpoints, release
   tags, and acceptance criteria.
7. [`06-vm-first-workflow.md`](06-vm-first-workflow.md) — make the Vagrant VM
   the default backend: fixes `/mnt/c` slowness, gives real isolation for the
   OpenClaw daemon, adds VS Code Remote-SSH ergonomics + snapshot workflow.

## Non-goals for phase 2

- No Windows-native agent install — WSL/VM remains the only supported
  sandbox.
- No custom model training or fine-tuning.
- No paid-channel integrations beyond what OpenClaw natively supports.
