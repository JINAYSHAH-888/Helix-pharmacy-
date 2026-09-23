#!/bin/bash
set -e
cd "$(dirname "$0")/.."
./scripts/compile.sh
java -cp out com.pharmacy.rmi.server.MumbaiServer
