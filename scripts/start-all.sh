#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/compile.sh

mkdir -p .runtime-logs
pids=()

start_node() {
  local name="$1"
  local class_name="$2"
  java -cp out "$class_name" > ".runtime-logs/${name}.log" 2>&1 &
  pids+=("$!")
}

start_node mumbai com.pharmacy.rmi.server.MumbaiServer
start_node pune com.pharmacy.rmi.server.PuneServer
start_node bengaluru com.pharmacy.rmi.server.BengaluruServer
start_node delhi com.pharmacy.rmi.server.DelhiServer
start_node hyderabad com.pharmacy.rmi.server.HyderabadServer
start_node chennai com.pharmacy.rmi.server.ChennaiServer

cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup INT TERM EXIT

echo "Six-node RMI cluster starting; logs are in .runtime-logs/"
echo "Open another terminal and run ./scripts/start-web.sh"
wait
