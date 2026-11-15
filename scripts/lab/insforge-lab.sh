#!/bin/sh
# Laboratorio aislado con InsForge OSS v2.3.5 (la versión de buziosflow) en este Mac. No toca ningún tenant.
#
#   sh scripts/lab/insforge-lab.sh up     # levanta PostgreSQL, PostgREST, InsForge y Mailpit; aplica las migraciones
#   sh scripts/lab/insforge-lab.sh down   # borra contenedores y volúmenes del laboratorio
#
# Todo escucha solo en 127.0.0.1 (API 47130, Mailpit 47025, PostgreSQL 47432). Las claves se generan en cada
# arranque y quedan en ~/LaboratorioBuziosFlow/lab.env (permisos 600), fuera del repositorio. El correo sale por
# SMTP hacia Mailpit, que lo guarda sin enviarlo a nadie. Las migraciones se aplican con el CLI de InsForge desde
# ~/LaboratorioBuziosFlow/cli (enlazado al laboratorio, no a buziosflow), igual que en el tenant: como
# project_admin. La 202611160004 (políticas de storage) no se puede aplicar así: queda sin aplicar, como allí.
set -eu

INSFORGE_VERSION=v2.3.5
INSFORGE_COMMIT=c1c886e775d286433e4b50c78c24335783e8fc00 # etiqueta v2.3.5
lab="$HOME/LaboratorioBuziosFlow"
repo="$PWD"
project=buziosflow-lab

containers="$project-insforge $project-postgrest $project-mailpit $project-postgres"
stop() {
  for name in $containers; do docker rm -f "$name" >/dev/null 2>&1 || true; done
  docker volume rm "$project-pgdata" "$project-storage" >/dev/null 2>&1 || true
  docker network rm "$project" >/dev/null 2>&1 || true
}

if [ "${1:-}" = down ]; then
  stop
  rm -rf "$lab/cli" "$lab/lab.env"
  exit 0
fi
[ "${1:-}" = up ] || { echo "Usage: sh scripts/lab/insforge-lab.sh up|down" >&2; exit 2; }

mkdir -p "$lab/db" "$lab/cli"
for file in db-init.sql jwt.sql postgresql.conf; do
  [ -s "$lab/db/$file" ] || curl -fsSL -o "$lab/db/$file" \
    "https://raw.githubusercontent.com/InsForge/InsForge/$INSFORGE_COMMIT/deploy/docker-init/db/$file"
done

umask 077
cat > "$lab/lab.env" <<EOF
LAB_URL=http://127.0.0.1:47130
LAB_MAILPIT=http://127.0.0.1:47025
LAB_PG=postgresql://postgres:$(openssl rand -hex 16)@127.0.0.1:47432/insforge
LAB_JWT_SECRET=$(openssl rand -hex 32)
LAB_API_KEY=ik_$(openssl rand -hex 24)
LAB_ANON_KEY=anon_$(openssl rand -hex 24)
LAB_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
umask 022
. "$lab/lab.env"
pg_password=$(printf '%s' "$LAB_PG" | sed 's|.*postgres:\([^@]*\)@.*|\1|')

stop
# InsForge rechaza servidores SMTP en rangos privados (anti-SSRF). La red del laboratorio usa 198.18.0.0/24 (RFC 2544,
# reservado para pruebas, no está en esa lista ni sale a Internet) para que acepte a Mailpit por su IP fija.
docker network create --subnet 198.18.0.0/24 "$project" >/dev/null
run() { name=$1; shift; docker run -d --name "$project-$name" --network "$project" --network-alias "$name" "$@" >/dev/null; }
run postgres -p 127.0.0.1:47432:5432 -v "$project-pgdata:/var/lib/postgresql/data" \
  -v "$lab/db/db-init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro" -v "$lab/db/jwt.sql:/docker-entrypoint-initdb.d/02-jwt.sql:ro" \
  -v "$lab/db/postgresql.conf:/etc/postgresql/postgresql.conf:ro" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$pg_password" -e POSTGRES_DB=insforge -e PGDATA=/var/lib/postgresql/data/pgdata \
  -e ENCRYPTION_KEY="$LAB_JWT_SECRET" -e JWT_SECRET="$LAB_JWT_SECRET" \
  ghcr.io/insforge/postgres:v15.13.4 postgres -c config_file=/etc/postgresql/postgresql.conf -c cron.database_name=insforge \
  -c app.encryption_key="$LAB_JWT_SECRET"
attempt=0
# El primer arranque reinicia PostgreSQL tras los scripts de inicio: se espera a que acepte conexiones TCP.
until docker exec "$project-postgres" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && \
      docker exec "$project-postgres" psql -h 127.0.0.1 -U postgres -d insforge -qAtc 'select 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -le 120 ] || { docker logs --tail 40 "$project-postgres" >&2; exit 1; }; sleep 1
done
run postgrest -e PGRST_DB_URI="postgres://postgres:$pg_password@postgres:5432/insforge" -e PGRST_DB_SCHEMA=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$LAB_JWT_SECRET" -e PGRST_DB_CHANNEL_ENABLED=true -e PGRST_DB_CHANNEL=pgrst \
  postgrest/postgrest:v12.2.12
run mailpit --ip 198.18.0.25 -p 127.0.0.1:47025:8025 -e MP_SMTP_BIND_ADDR=0.0.0.0:2525 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
  public.ecr.aws/supabase/mailpit:v1.31.3
run insforge -p 127.0.0.1:47130:7130 -v "$project-storage:/insforge-storage" \
  -e PORT=7130 -e PROJECT_ROOT=/app -e API_BASE_URL="$LAB_URL" -e VITE_API_BASE_URL="$LAB_URL" \
  -e JWT_SECRET="$LAB_JWT_SECRET" -e ENCRYPTION_KEY="$LAB_JWT_SECRET" \
  -e ROOT_ADMIN_USERNAME=admin -e ROOT_ADMIN_PASSWORD="$LAB_ADMIN_PASSWORD" -e ADMIN_EMAIL=admin -e ADMIN_PASSWORD="$LAB_ADMIN_PASSWORD" \
  -e POSTGRES_HOST=postgres -e POSTGRES_PORT=5432 -e POSTGRES_DB=insforge -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$pg_password" \
  -e DATABASE_URL="postgresql://postgres:$pg_password@postgres:5432/insforge" -e POSTGREST_BASE_URL=http://postgrest:3000 \
  -e ACCESS_API_KEY="$LAB_API_KEY" -e ACCESS_ANON_KEY="$LAB_ANON_KEY" -e INSFORGE_TELEMETRY_DISABLED=1 \
  -e STORAGE_DIR=/insforge-storage -e LOGS_DIR=/insforge-logs \
  "ghcr.io/insforge/insforge-oss:$INSFORGE_VERSION"
attempt=0
until curl -fs "$LAB_URL/api/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1)); [ "$attempt" -le 180 ] || { docker logs --tail 40 "$project-insforge" >&2; exit 1; }; sleep 1
done
echo "InsForge $(curl -fs "$LAB_URL/api/health" | sed 's/.*"version":"\([^"]*\)".*/\1/') ready at $LAB_URL"

admin_put() { curl -fsS -X PUT -H "Authorization: Bearer $LAB_API_KEY" -H 'Content-Type: application/json' "$LAB_URL/api/auth/$1" -d "$2" >/dev/null; }
# Como buziosflow: verificación de correo y recuperación de contraseña con código de 6 dígitos.
# InsForge exige un proveedor de correo antes de pedir verificación: primero SMTP (Mailpit).
admin_put smtp-config '{"enabled":true,"host":"198.18.0.25","port":2525,"username":"lab","password":"lab","senderEmail":"lab@buziosflow.test","senderName":"Laboratorio","minIntervalSeconds":0}'
admin_put config '{"requireEmailVerification":true,"verifyEmailMethod":"code","resetPasswordMethod":"code","passwordMinLength":6}'

cd "$lab/cli"
npx -y @insforge/cli link --api-base-url "$LAB_URL" --api-key "$LAB_API_KEY" >/dev/null
rm -rf migrations && mkdir migrations && cp "$repo"/migrations/*.sql migrations/
rm migrations/*_offer-media-storage.sql # necesita ser dueño de storage.objects: no se aplica, como en buziosflow
npx -y @insforge/cli db migrations up --all
echo "Lab ready. Variables in $lab/lab.env; mail at $LAB_MAILPIT"
