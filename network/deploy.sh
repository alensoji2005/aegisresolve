#!/usr/bin/env bash
# Deploy/upgrade aegis-cc. Usage: network/deploy.sh <sequence>   (1 for first deploy, then 2, 3, ...)
set -euo pipefail
SEQ="${1:?usage: deploy.sh <sequence>}"
CC_PATH="${AEGIS_ROOT:-$HOME/aegis}/chaincode/aegis-cc"
# After a machine/codespace restart the Fabric containers are stopped; bring them back first.
stopped=$(docker ps -aq --filter status=exited --filter name=example.com)
if [ -n "$stopped" ]; then docker start $stopped >/dev/null && sleep 5; fi
cd "${FABRIC_SAMPLES:-$HOME/fabric-samples}/test-network"
./network.sh deployCC -c aegischannel -ccn aegis-cc -ccp "$CC_PATH" -ccl typescript -ccv "$SEQ" -ccs "$SEQ"
