#!/bin/bash
# Create (or recreate) the PostgreSQL database the whole system reads from, and load
# the schema + seed rows from sql/pharmacy_schema.sql.
#   ./scripts/db-setup.sh            create helixis_pharmacy if it does not exist
#   ./scripts/db-setup.sh --reset    drop it first and reload the seed data
# Override the name with PHARMACY_DB_NAME (then point the app at it with PHARMACY_DB_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${PHARMACY_DB_NAME:-helixis_pharmacy}"

if ! pg_isready -q; then
  echo "PostgreSQL is not running. Start it first, e.g.: brew services start postgresql@18" >&2
  exit 1
fi
if [[ "${1:-}" == "--reset" ]]; then
  echo "Dropping $DB …"
  dropdb --if-exists "$DB"
fi
if psql -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
  echo "$DB already exists — leaving its data as is (use --reset to reload the seed)."
else
  createdb "$DB"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f sql/pharmacy_schema.sql
  echo "Created $DB and loaded sql/pharmacy_schema.sql."
fi
psql -d "$DB" -c "SELECT 'pharmacy_branches' AS table_name, count(*) FROM pharmacy_branches
  UNION ALL SELECT 'medicines', count(*) FROM medicines
  UNION ALL SELECT 'prescriptions', count(*) FROM prescriptions
  UNION ALL SELECT 'branch_inventory', count(*) FROM branch_inventory
  UNION ALL SELECT 'dispensing_transactions', count(*) FROM dispensing_transactions;"
