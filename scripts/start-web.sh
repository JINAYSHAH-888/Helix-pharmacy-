#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/compile.sh
exec java -Dpharmacy.web.root="$PWD" -cp out com.pharmacy.rmi.api.PharmacyWebServer
