#!/usr/bin/env bash
# One-time setup inside a GitHub Codespace: tools, dependencies, Fabric binaries, .env, trained AI model.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Node dependencies"
sudo corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm install
npm install --prefix chaincode/aegis-cc

echo "== Python environment + AI model"
python3 -m venv ai/.venv
ai/.venv/bin/pip install -q -r ai/requirements.txt
ai/.venv/bin/python -m ai.corpus.generate
ai/.venv/bin/python -m ai.train_classifier

echo "== Hyperledger Fabric 2.5 binaries, samples (docker images are pulled when the network starts)"
cd "$HOME"
if [ ! -d fabric-samples ]; then
  curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
  chmod +x install-fabric.sh
  ./install-fabric.sh --fabric-version 2.5.10 --ca-version 1.5.13 samples binary
fi
grep -q fabric-samples/bin ~/.bashrc || echo 'export PATH=$HOME/fabric-samples/bin:$PATH' >> ~/.bashrc
cd "$ROOT"

echo "== .env with fresh secrets (Fabric mode)"
if [ ! -f .env ]; then
  b64() { openssl rand -base64 "$1" | tr -d '\n'; }
  sed -e "s|^AEGIS_KEK=.*|AEGIS_KEK=$(b64 32)|" \
      -e "s|^PSEUDONYM_SECRET=.*|PSEUDONYM_SECRET=$(b64 32)|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(b64 64)|" \
      -e "s|^WALLET_KEK=.*|WALLET_KEK=$(b64 32)|" \
      -e "s|^AI_SHARED_SECRET=.*|AI_SHARED_SECRET=$(openssl rand -hex 24)|" \
      -e "s|^FABRIC_ORGS_DIR=.*|FABRIC_ORGS_DIR=$HOME/fabric-samples/test-network/organizations|" \
      .env.example > .env
  chmod 600 .env
fi
echo "Setup done. Next: bash scripts/start-fabric.sh"
