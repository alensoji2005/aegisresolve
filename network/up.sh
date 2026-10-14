#!/usr/bin/env bash
# Start Fabric test-network (2 orgs + CAs) and create the AegisResolve channel.
set -euo pipefail
cd "${FABRIC_SAMPLES:-$HOME/fabric-samples}/test-network"
./network.sh up createChannel -c aegischannel -ca
