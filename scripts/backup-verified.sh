#!/bin/sh
# Respaldo completo de buziosflow con recuperación comprobada, sin tocar la base productiva:
#
#   sh scripts/backup-verified.sh [carpeta]     # por defecto ~/RespaldosBuziosFlow/<fecha>_snapshot
#
# 1. Con la URL de postgres que da `insforge db connection-string` (nunca se imprime) exporta un snapshot, toma
#    pg_dump -Fc de la base entera con ese snapshot, los roles sin contraseñas y la huella
#    (supabase/checks/database_fingerprint.sql) en la misma transacción de solo lectura.
# 2. Restaura en un PostgreSQL 15 local con pgvector, pg_cron y http, en una red de Docker sin salida y con
#    cron.launch_active_jobs=off: los trabajos de pg_cron restaurados llaman al tenant real.
# 3. Compara las huellas ordenadas. Sale con error si difieren o si la restauración falla por algo distinto de
#    SET transaction_timeout (pg_dump 17 contra PostgreSQL 15).
# El resultado contiene hashes de contraseñas y secretos cifrados: queda con permisos de solo lectura para el dueño.
set -eu

project=$(npx -y @insforge/cli current 2>&1 | sed -n 's/^ *Project: *\([^ ]*\).*/\1/p')
[ "$project" = 'buziosflow' ] || { echo "Linked project is '$project', expected buziosflow" >&2; exit 1; }
out="${1:-$HOME/RespaldosBuziosFlow/$(date -u +%Y%m%d_%H%M%S)_snapshot}"
case "$out" in "$PWD"/*) echo "Backups must live outside the repository" >&2; exit 2 ;; esac
[ ! -e "$out" ] || { echo "$out already exists" >&2; exit 2; }
mkdir -p "$out"
chmod 700 "$out"
cp supabase/checks/database_fingerprint.sql "$out/fingerprint.sql"

image=buziosflow-restore-pg15:local
printf 'FROM postgres:15\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-15-pgvector postgresql-15-cron postgresql-15-http && rm -rf /var/lib/apt/lists/*\n' > "$out/Dockerfile"
docker image inspect "$image" >/dev/null 2>&1 || docker build -q -t "$image" - < "$out/Dockerfile" >/dev/null

url=$(npx -y @insforge/cli db connection-string 2>/dev/null | grep -oE 'postgres(ql)?://[^ ]+' | head -1)
[ -n "$url" ] || { echo "Could not read the connection string" >&2; exit 1; }
cat > "$out/dump.sh" <<'EOF'
set -eu
mkfifo /tmp/in
psql "$U" -q -v ON_ERROR_STOP=1 < /tmp/in > /out/session.txt 2>&1 &
exec 3>/tmp/in
echo "begin isolation level repeatable read read only; select 'SNAP:'||pg_export_snapshot()||':'||now();" >&3
for i in $(seq 60); do grep -q 'SNAP:' /out/session.txt && break; sleep 1; done
snap=$(grep -o 'SNAP:[^:]*' /out/session.txt | cut -d: -f2)
pg_dump "$U" -Fc --snapshot="$snap" -f /out/insforge.dump
pg_dumpall -d "$U" --roles-only --no-role-passwords -f /out/roles.sql
printf '\\o /out/fp_remote.txt\n\\i /out/fingerprint.sql\n\\o\ncommit;\n' >&3
exec 3>&-
wait
grep -o 'SNAP:.*' /out/session.txt > /out/snapshot.txt
rm /out/session.txt
EOF
docker run --rm -e U="$url" -v "$out:/out" postgres:17 sh /out/dump.sh
unset url
echo "Dumped $(cut -d: -f3- "$out/snapshot.txt") UTC"

name="bf-verify-$$"
docker network create --internal "$name" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1; docker network rm "$name" >/dev/null 2>&1' EXIT INT TERM
docker run -d --name "$name" --network "$name" -e POSTGRES_PASSWORD=restore-local -e POSTGRES_DB=insforge "$image" \
  -c shared_preload_libraries=pg_cron,pg_stat_statements -c cron.database_name=insforge \
  -c cron.launch_active_jobs=off >/dev/null
for i in $(seq 30); do docker exec "$name" pg_isready -U postgres -d insforge >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker run --rm --network "$name" -e PGPASSWORD=restore-local -e H="$name" -v "$out:/out" postgres:17 sh -c '
  psql -h "$H" -U postgres -d insforge -q -f /out/roles.sql 2>&1 | grep -v "already exists" || true
  pg_restore -h "$H" -U postgres -d insforge /out/insforge.dump > /out/restore_log.txt 2>&1 || true'
unexpected=$(grep 'error:' "$out/restore_log.txt" | grep -v 'transaction_timeout' | grep -vc 'errors ignored on restore' || true)
docker exec -i "$name" psql -U postgres -d insforge -q -v ON_ERROR_STOP=1 < "$out/fingerprint.sql" > "$out/fp_restored.txt"
sort "$out/fp_remote.txt" > "$out/fp_remote.sorted"
sort "$out/fp_restored.txt" > "$out/fp_restored.sorted"
status=0
if diff "$out/fp_remote.sorted" "$out/fp_restored.sorted" > "$out/fp_diff.txt"; then
  echo "PASS restore matches the tenant ($(wc -l < "$out/fp_remote.txt" | tr -d ' ') fingerprint lines, $(grep -c '^data|' "$out/fp_remote.txt") tables)"
else
  echo "FAIL restore differs from the tenant: see $out/fp_diff.txt"; status=1
fi
[ "$unexpected" -eq 0 ] || { echo "FAIL unexpected restore errors: see $out/restore_log.txt"; status=1; }
rm -f "$out/dump.sh" "$out/fp_remote.sorted" "$out/fp_restored.sorted"
(cd "$out" && find . -type f ! -name MANIFEST.sha256 | sort | xargs shasum -a 256 > MANIFEST.sha256)
find "$out" -type f -exec chmod 400 {} +
chmod 500 "$out"
echo "Backup in $out"
exit "$status"
