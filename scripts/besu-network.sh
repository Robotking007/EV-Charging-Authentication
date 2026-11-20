#!/usr/bin/env bash
set -euo pipefail

project="$(pwd)"
state="$project/.local-chain"
work_id="$(printf '%s' "$project" | sha256sum | cut -c1-16)"
network="$HOME/.local/share/ev-trust-networks/$work_id"
tools="$HOME/.local/share/ev-trust-tools"
besu="${BESU_EXECUTABLE:-$tools/besu-26.11.1/bin/besu}"
if [[ -x "$tools/jdk/bin/java" ]]; then
  export JAVA_HOME="$tools/jdk"
fi
export JAVA_OPTS="${JAVA_OPTS:--Xms128m -Xmx768m -XX:ActiveProcessorCount=2} -Djava.net.preferIPv4Stack=true"
cors_origins="http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
# The wallet extension validates the chain ID from its own browser origin.
cors_origins+=",chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn,chrome-extension://ejbalbakoplchlghecdalmeeeajnimhm"

stop_nodes() {
  for node in "$network"/node-*; do
    [[ -f "$node/pid" ]] || continue
    pid="$(cat "$node/pid")"
    if [[ -r "/proc/$pid/cmdline" ]] && tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "--data-path=$node/data"; then
      kill "$pid"
    fi
    rm -f -- "$node/pid"
  done
}

if [[ "$1" == down ]]; then
  stop_nodes
  exit
fi

if [[ ! -x "$besu" ]]; then
  besu="$(command -v besu || true)"
fi
if [[ -z "$besu" ]]; then
  echo "Besu executable is required. Set BESU_EXECUTABLE or install Besu and Java as described in README.md." >&2
  exit 1
fi

umask 077
mkdir -p "$network"
if [[ ! -f "$network/genesis.json" ]]; then
  "$besu" operator generate-blockchain-config --config-file="$state/ibft-config.json" \
    --to="$network/generated" --private-key-file-name=key
  index=0
  enodes=()
  for key_dir in "$network"/generated/keys/*; do
    node="$network/node-$index"
    mkdir -p "$node/data"
    cp "$key_dir/key" "$node/key"
    pubkey="$(cat "$key_dir/key.pub")"
    enodes+=("enode://${pubkey#0x}@127.0.0.1:$((30313 + index))")
    index=$((index + 1))
  done
  for ((i=0; i<4; i++)); do
    {
      printf '['
      separator=""
      for ((j=0; j<4; j++)); do
        if [[ "$i" != "$j" ]]; then
          printf '%s"%s"' "$separator" "${enodes[j]}"
          separator=","
        fi
      done
      printf ']\n'
    } > "$network/node-$i/static-nodes.json"
  done
  cp "$network/generated/genesis.json" "$network/genesis.json"
fi

for ((i=0; i<4; i++)); do
  node="$network/node-$i"
  if [[ -f "$node/pid" ]] && kill -0 "$(cat "$node/pid")" 2>/dev/null; then
    continue
  fi
  nohup "$besu" --genesis-file="$network/genesis.json" --data-path="$node/data" \
    --node-private-key-file="$node/key" --static-nodes-file="$node/static-nodes.json" \
    --discovery-enabled=false --nat-method=NONE --p2p-interface=127.0.0.1 --p2p-host=127.0.0.1 \
    --p2p-port="$((30313+i))" --rpc-http-enabled --rpc-http-host=127.0.0.1 \
    --rpc-http-port="$((8547+i))" --rpc-http-api=ETH,NET,IBFT \
    --rpc-http-cors-origins="$cors_origins" \
    --host-allowlist=localhost,127.0.0.1 --metrics-enabled=false --logging=INFO \
    > "$node/besu.log" 2>&1 < /dev/null &
  echo "$!" > "$node/pid"
done
printf 'Besu validator logs are under %s\n' "$network"
rpc='{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
for ((attempt=0; attempt<90; attempt++)); do
  if curl -fs --max-time 2 -H 'Content-Type: application/json' --data "$rpc" http://127.0.0.1:8547 \
    | grep -Eq '"result":"0x[1-9a-f][0-9a-f]*"'; then
    echo "Besu IBFT network is producing blocks on chain 43210. RPC ports are 8547–8550."
    exit
  fi
  sleep 1
done
echo "Besu did not produce a block. Check the validator logs at $network." >&2
exit 1
