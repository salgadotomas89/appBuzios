# Segunda jornada autónoma — sábado 14 de noviembre de 2026 (noche)

Rama: `work/dev-2026-11-15`, desde `main` = `08a837a`. Horas en America/Santiago (UTC−3), tomadas de `date`.
Inicio: **20:21**. Bitácora anterior: [operacion-2026-11-14c.md](operacion-2026-11-14c.md).

## Auditoría inicial (20:21)

`main` = `origin/main` = `08a837a`, CI verde, once migraciones, tsc y ESLint limpios, Jest 161/161, PostgreSQL 46.
Coincide con lo reportado.

## Checkpoint 1 (21:10, unos 49 min de reloj)

Merge a `main`: `793512e` (CI de `main` run 43656694925 en verde).

- **Sesiones seguras** (`5a4d230`): `react-native-keychain@10.0.0` (MIT, fijada; la 11.0.0 tenía 8 días). El SDK
  1.5.2 guarda la sesión en memoria; su flujo móvil documentado (`isServerMode`, marcado obsoleto) devuelve un
  refreshToken. Gestor propio: guarda solo `{ userId, refreshToken }` en Keychain/Keystore, restaura al abrir,
  renueva antes de caducar, distingue sesión caducada de sin conexión y borra al cerrar sesión. Probado con
  dobles; build iOS de simulador compila con RNKeychain. **No probado en dispositivo ni contra el tenant.**
- **Alta de proveedores y administración** (`999e435`, `2c6ffa8`): solicitudes revisadas por admin con comisión
  explícita, moderación de ofertas, registro de actividad por triggers, incidencias, usuarios, indicadores y
  campañas solo de contenido. Consola de administración y servicios del turista en el portal. Prueba de contrato
  entre cada RPC llamado por la app y las firmas SQL.
- **Fotos** (`71a9fd4`): política de imágenes (tipo real por cabecera, tamaño, dimensiones, texto alternativo),
  adaptador de almacenamiento desactivado por defecto (sin bucket confirmado), metadatos en SQL y galería en el
  detalle.
- **Defecto antiguo corregido**: un visitante sin sesión no podía leer ofertas ni inventario (las políticas
  consultaban `connectical_providers`, ilegible para `anon`). Migración `202611150004`.
- **CI**: dos pruebas dependían de la hora (UTC frente al día de Búzios) y fallaban de 21:00 a medianoche de Búzios;
  corregidas (`667f0bb`, `89e2d96`) y Jest corre ahora también con `TZ=Asia/Tokyo`.
- Quince migraciones: base vacía, actualización desde etapas 1 y 4 y doble aplicación correctas.
- Jest 195/195 · PostgreSQL 50.
