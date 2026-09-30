#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/compile.sh
exec java -Dpharmacy.web.root="$PWD" -cp "out:lib/postgresql-42.7.4.jar" com.pharmacy.rmi.api.PharmacyWebServer
