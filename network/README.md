# Fabric network (run inside WSL2 Ubuntu)

One-time setup:

1. In an admin PowerShell, run `wsl --install -d Ubuntu-24.04` and reboot. Install Docker Desktop and enable WSL integration for Ubuntu.
2. In Ubuntu:
   ```bash
   sudo apt update && sudo apt install -y git curl jq build-essential
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 20
   ln -s "/mnt/d/projects/Aegis-Blockchain Munitions" ~/aegis   # Fabric scripts break on the space in the path
   cd ~ && curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh && chmod +x install-fabric.sh
   ./install-fabric.sh --fabric-version 2.5.10 --ca-version 1.5.13 docker samples binary
   echo 'export PATH=$HOME/fabric-samples/bin:$PATH' >> ~/.bashrc
   ```

Every session:

```bash
~/aegis/network/up.sh
~/aegis/network/deploy.sh 1      # bump the number on every redeploy
~/aegis/network/down.sh          # wipes ledger + CA state
```

Smoke check (Org1 env from test-network `scripts/envVar.sh` / `setGlobals 1`):

```bash
peer chaincode query -C aegischannel -n aegis-cc -c '{"function":"complaint:ping","Args":[]}'   # -> pong
```

DepotOrg = Org1MSP (CA :7054, peer :7051). OversightOrg = Org2MSP (CA :8054, peer :9051).
