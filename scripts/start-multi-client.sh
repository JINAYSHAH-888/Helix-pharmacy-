#!/bin/bash
set -e
cd "$(dirname "$0")/.."
./scripts/compile.sh
java -cp "out:lib/postgresql-42.7.4.jar" com.pharmacy.rmi.client.ConcurrentClientDemo
