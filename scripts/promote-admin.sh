#!/bin/sh
# Alta de administradores en buziosflow por SQL (no hay RPC para asignar roles, a propósito).
#
#   sh scripts/promote-admin.sh correo@equipo.com              # solo informa qué pasaría
#   sh scripts/promote-admin.sh correo@equipo.com --apply      # promueve al primer administrador
#   sh scripts/promote-admin.sh correo@equipo.com --apply --additional   # otro admin cuando ya hay uno
#   sh scripts/promote-admin.sh correo@equipo.com --print-sql [--apply] [--additional]
#
# Solo promueve una cuenta que existe en auth.users, con el correo verificado, no anónima, que ya inició sesión
# en la app (tiene perfil) y cuyo rol es traveler. Nunca convierte a un proveedor. Sin --additional se niega si
# ya hay un administrador. Todo ocurre en una sola sentencia y el trigger de auditoría registra role_changed
# con actor nulo. Imprime un único resultado: would_promote, promoted o el motivo del rechazo.
set -eu

email="${1:-}"
apply=false
additional=false
print_sql=false
[ "$#" -gt 0 ] && shift
for arg in "$@"; do
  case "$arg" in
    --apply) apply=true ;;
    --additional) additional=true ;;
    --print-sql) print_sql=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
# El correo va dentro del SQL: solo se aceptan caracteres que no pueden cerrar la cadena.
if ! printf '%s' "$email" | grep -Eq '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$'; then
  echo "Usage: sh scripts/promote-admin.sh <email> [--apply] [--additional] [--print-sql]" >&2
  exit 2
fi

sql="with target as (
  select u.id, u.email_verified, u.is_anonymous, p.role
  from auth.users u left join public.connectical_profiles p on p.user_id = u.id
  where lower(u.email) = lower('$email')
), admins as (
  select count(*) as n from public.connectical_profiles where role = 'admin'
), promoted as (
  update public.connectical_profiles p set role = 'admin'
  from target t, admins a
  where $apply and p.user_id = t.id and t.email_verified and not t.is_anonymous and p.role = 'traveler'
    and (a.n = 0 or $additional)
  returning p.user_id
)
select case
  when (select count(*) from target) <> 1 then 'user_not_found'
  when not (select email_verified from target) then 'email_not_verified'
  when (select is_anonymous from target) then 'anonymous_user'
  when (select role from target) is null then 'profile_missing'
  when (select role from target) = 'admin' then 'already_admin'
  when (select role from target) <> 'traveler' then 'not_a_traveler'
  when (select n from admins) > 0 and not $additional then 'admin_exists'
  when exists (select 1 from promoted) then 'promoted'
  when not $apply then 'would_promote'
  else 'not_promoted'
end as outcome"

if [ "$print_sql" = true ]; then
  printf '%s;\n' "$sql"
  exit 0
fi

project=$(npx -y @insforge/cli current 2>&1 | sed -n 's/^ *Project: *\([^ ]*\).*/\1/p')
[ "$project" = 'buziosflow' ] || { echo "Linked project is '$project', expected buziosflow" >&2; exit 1; }
outcome=$(npx -y @insforge/cli db query "$sql" --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["rows"][0]["outcome"])')
echo "$outcome"
case "$outcome" in promoted|would_promote) ;; *) exit 1 ;; esac
