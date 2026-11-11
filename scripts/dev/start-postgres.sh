#!/usr/bin/env bash
# يشغّل عنقود PostgreSQL محلياً للتطوير داخل بيئات بلا خدمة قاعدة بيانات (للتطوير فقط).
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${PGDATA_DIR:-/var/lib/postgresql/aqarlite-data}
if "$PGBIN/pg_isready" -h 127.0.0.1 -p 5432 -q; then echo "postgres already running"; exit 0; fi
rm -f "$DATA/postmaster.pid"
su postgres -c "$PGBIN/pg_ctl -D $DATA -o '-p 5432 -c listen_addresses=127.0.0.1 -c max_connections=200' -l /var/lib/postgresql/aqarlite.log start"
sleep 2
"$PGBIN/pg_isready" -h 127.0.0.1 -p 5432
