#!/usr/bin/env bash
set -euo pipefail
cd "${FABRIC_SAMPLES:-$HOME/fabric-samples}/test-network"
./network.sh down
