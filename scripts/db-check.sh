#!/bin/bash
# Usage: start the database, ./scripts/start-all.sh and ./scripts/start-web.sh, then run this.
# Every write it makes is reverted before it exits.
# End-to-end PostgreSQL connectivity check for Helixis.
DB=helixis_pharmacy; API=http://localhost:8080/api
ok(){ printf "  PASS  %s\n" "$1"; }; bad(){ printf "  FAIL  %s\n" "$1"; FAILED=1; }
echo "1. Server"; pg_isready -q && ok "PostgreSQL accepting connections ($(psql -Atc 'show server_version' -d $DB))" || bad "pg_isready"
echo "2. Row counts: database vs API"
ov=$(curl -s $API/overview)
for pair in "pharmacy_branches:branches" "medicines:medicines" "prescriptions:prescriptions" "branch_inventory:inventoryRows" "dispensing_transactions:transactions"; do
  t=${pair%%:*}; k=${pair##*:}; db=$(psql -Atc "select count(*) from $t" -d $DB); api=$(echo "$ov" | python3 -c "import json,sys;print(json.load(sys.stdin)['counts']['$k'])")
  [ "$db" = "$api" ] && ok "$t  db=$db api=$api" || bad "$t  db=$db api=$api"
done
echo "3. Source reported by the gateway"; curl -s $API/database | python3 -c "import json,sys;print('  ', json.load(sys.stdin)['engine'])"
echo "4. RMI nodes query PostgreSQL"
curl -s "$API/search?type=MEDICINE&q=MED-0008" | python3 -c "
import json,sys;d=json.load(sys.stdin);r=d['rmi'];print('   connected:',r.get('connected'),'| per-node matches:',{n['name']:n['matches'] for n in r.get('nodes',[])})"
echo "5. Live write-through (SQL UPDATE -> API)"
q(){ curl -s $API/medicines | python3 -c "import json,sys;print([m['manufacturer'] for m in json.load(sys.stdin)['items'] if m['code']=='MED-0003'][0])"; }
orig=$(q); psql -qd $DB -c "update medicines set manufacturer='PG-CHECK' where medicine_code='MED-0003'"; sleep 2.5; now=$(q)
psql -qd $DB -c "update medicines set manufacturer='$orig' where medicine_code='MED-0003'"; sleep 2.5; back=$(q)
[ "$now" = "PG-CHECK" ] && ok "update visible via API ($orig -> $now)" || bad "update not visible ($now)"
[ "$back" = "$orig" ] && ok "revert visible via API ($back)" || bad "revert ($back)"
echo "6. Insert + delete (new row appears and disappears)"
c1=$(curl -s $API/medicines | python3 -c "import json,sys;print(len(json.load(sys.stdin)['items']))")
psql -qd $DB -c "insert into medicines (medicine_code,name,generic_name,category,unit_of_measure,manufacturer) values ('MED-9999','PG Check 1mg','Check','Test','tablet','Helixis')"; sleep 2.5
c2=$(curl -s $API/medicines | python3 -c "import json,sys;print(len(json.load(sys.stdin)['items']))")
psql -qd $DB -c "delete from medicines where medicine_code='MED-9999'"; sleep 2.5
c3=$(curl -s $API/medicines | python3 -c "import json,sys;print(len(json.load(sys.stdin)['items']))")
[ $((c1+1)) = "$c2" ] && [ "$c3" = "$c1" ] && ok "medicines $c1 -> $c2 -> $c3" || bad "medicines $c1 -> $c2 -> $c3"

[ -z "$FAILED" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
