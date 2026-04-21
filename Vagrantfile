# Genesis VM fallback — Ubuntu 22.04 with 8 GB / 4 CPU default.
# Used only when the user picks `-Mode vm`. WSL2 is the default path.
#
# Requires: VirtualBox + Vagrant installed on Windows host.
# Conflicts: VirtualBox performance degrades under Hyper-V/WSL2; disable
# Hyper-V or accept the hit. Alternative: `vagrant up --provider=hyperv`.

Vagrant.configure("2") do |config|
  config.vm.box      = "ubuntu/jammy64"
  config.vm.hostname = "genesis"

  # --- port forwards (host → guest) ---
  config.vm.network "forwarded_port", guest: 18789, host: 18789  # OpenClaw
  config.vm.network "forwarded_port", guest: 8080,  host: 8080   # ClawTeam board
  config.vm.network "forwarded_port", guest: 11434, host: 11435  # guest Ollama (shifted)

  # --- shared folder (this repo ↔ /vagrant) ---
  config.vm.synced_folder ".", "/vagrant", type: "virtualbox"

  # --- provider sizing (8 GB / 4 CPU — see docs/research.md §4) ---
  config.vm.provider "virtualbox" do |vb|
    vb.memory = 8192
    vb.cpus   = 4
    vb.name   = "genesis"
    vb.customize ["modifyvm", :id, "--ioapic", "on"]
    vb.customize ["modifyvm", :id, "--nested-hw-virt", "on"]
  end

  config.vm.provider "hyperv" do |hv|
    hv.memory  = 8192
    hv.cpus    = 4
    hv.vmname  = "genesis"
  end

  # --- provisioning: shared script with WSL path ---
  # Forward catalog-selection env from host shell (set by setup-genesis.ps1).
  prov_env = {
    "GENESIS_OLLAMA_HOST"  => "http://10.0.2.2:11434",  # VirtualBox NAT → host
    "GENESIS_ENABLE"       => ENV.fetch("GENESIS_ENABLE",  ""),
    "GENESIS_DISABLE"      => ENV.fetch("GENESIS_DISABLE", ""),
    "GENESIS_SKIP_SKILLS"  => ENV.fetch("GENESIS_SKIP_SKILLS",  "0"),
    "GENESIS_SKIP_MCPS"    => ENV.fetch("GENESIS_SKIP_MCPS",    "0"),
    "GENESIS_SKIP_OPENCLAW"=> ENV.fetch("GENESIS_SKIP_OPENCLAW","0"),
  }
  config.vm.provision "shell", privileged: false, env: prov_env, inline: <<-SHELL
    set -e
    cd /vagrant
    chmod +x provision.sh
    GENESIS_HOME=/vagrant bash ./provision.sh
  SHELL
end
