# Genesis VM — Ubuntu 24.04 with 8 GB / 4 CPU default.
#
# Two ways to use:
#   1. Fallback:  -Mode vm                 (standard VM provision)
#   2. VM-first:  -VMFirst                 (VM as daily driver; see docs/)
#
# Requires: VirtualBox + Vagrant on the Windows host.
# Conflicts: VirtualBox perf degrades under Hyper-V/WSL2; disable Hyper-V
# or use `vagrant up --provider=hyperv`.
#
# Env knobs (all optional; wizard sets them or the user exports them):
#   GENESIS_VM_MEMORY       default 8192 MiB
#   GENESIS_VM_CPUS         default 4
#   GENESIS_VM_NAME         default "genesis-dev"
#   GENESIS_SYNC_PROJECTS   absolute Windows path to mount at
#                           /home/vagrant/shared-projects (opt-in).
#                           Default: not mounted (VM disk stays isolated).
#   GENESIS_ENABLE          forwarded to provision.sh
#   GENESIS_DISABLE         forwarded to provision.sh
#   GENESIS_SKIP_*          forwarded to provision.sh

Vagrant.configure("2") do |config|
  config.vm.box      = "bento/ubuntu-24.04"
  config.vm.hostname = "genesis"

  # SSH agent forwarding: host's ssh-agent (e.g. your GitHub key) flows into
  # the VM so `git push` works without PATs or copied keyfiles.
  config.ssh.forward_agent = true

  # --- port forwards (host → guest) ---
  config.vm.network "forwarded_port", guest: 18789, host: 18789  # OpenClaw
  config.vm.network "forwarded_port", guest: 8080,  host: 8080   # ClawTeam board
  config.vm.network "forwarded_port", guest: 11434, host: 11435  # guest Ollama (shifted)

  # --- shared folders ---
  # /vagrant is where Vagrant itself mounts the repo (used for provisioning).
  # Mount it read-only so agents inside the VM cannot scribble into your
  # Windows checkout. They still see the catalog/provision.sh for reference.
  config.vm.synced_folder ".", "/vagrant",
    type: "virtualbox",
    mount_options: ["ro"]

  # Optional: sync a Windows projects folder into the VM for editing from
  # Windows-native tools. OPT-IN because the whole point of VM-first is to
  # keep the host disk out of reach.
  projects_dir = ENV.fetch("GENESIS_SYNC_PROJECTS", "")
  if !projects_dir.empty? && File.directory?(projects_dir)
    config.vm.synced_folder projects_dir, "/home/vagrant/shared-projects",
      type: "virtualbox"
  end

  # --- provider sizing ---
  vm_memory = (ENV["GENESIS_VM_MEMORY"] || "8192").to_i
  vm_cpus   = (ENV["GENESIS_VM_CPUS"]   || "4").to_i
  vm_name   = ENV["GENESIS_VM_NAME"]    || "genesis-dev"

  config.vm.provider "virtualbox" do |vb|
    vb.memory = vm_memory
    vb.cpus   = vm_cpus
    vb.name   = vm_name
    vb.customize ["modifyvm", :id, "--ioapic", "on"]
    vb.customize ["modifyvm", :id, "--nested-hw-virt", "on"]
  end

  config.vm.provider "hyperv" do |hv|
    hv.memory  = vm_memory
    hv.cpus    = vm_cpus
    hv.vmname  = vm_name
  end

  # --- provisioning ---
  prov_env = {
    "GENESIS_OLLAMA_HOST"   => "http://10.0.2.2:11434",  # VirtualBox NAT → host
    "GENESIS_ENABLE"        => ENV.fetch("GENESIS_ENABLE",  ""),
    "GENESIS_DISABLE"       => ENV.fetch("GENESIS_DISABLE", ""),
    "GENESIS_SKIP_SKILLS"   => ENV.fetch("GENESIS_SKIP_SKILLS",  "0"),
    "GENESIS_SKIP_MCPS"     => ENV.fetch("GENESIS_SKIP_MCPS",    "0"),
    "GENESIS_SKIP_OPENCLAW" => ENV.fetch("GENESIS_SKIP_OPENCLAW","0"),
    "GENESIS_VM_MODE"       => "1",                      # tell provision.sh it's in the VM
  }
  config.vm.provision "shell", privileged: false, env: prov_env, inline: <<-SHELL
    set -e
    cd /vagrant
    chmod +x provision.sh
    GENESIS_HOME=/vagrant bash ./provision.sh
  SHELL
end
