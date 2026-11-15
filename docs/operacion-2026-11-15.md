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

## Checkpoint final (21:45, unos 84 min de reloj desde el inicio a las 20:21)

Merges a `main`: `793512e` y `674e247` (CI de `main` run 43659640118 en verde, incluidos Jest en dos zonas
horarias, integración PostgreSQL, ensayo de actualización desde las etapas 1, 4 y 11 e inventario de esquema).

- Después del checkpoint 1: favoritos y filtros (`32a6cb7`), inglés con aviso de revisión pendiente (`a72d584`),
  firma de Android y script de entorno (`a223940`), inventario de esquema (`08a14d0`), documentación.
- Revisión independiente del diff de la jornada: dos hallazgos medios y cinco menores, corregidos en `d0aba22`:
  cerrar sesión durante una renovación en curso resucitaba la sesión (ahora con época y espera de operaciones
  pendientes, tres pruebas de carrera que fallan con el código anterior); la URL de las fotos la elegía el cliente
  (ahora la construye el servidor desde un bucket https configurado); una cotización anterior a una suspensión
  permitía retener; filtro de personas en ofertas por grupo; retirada de fotos; renovación de sesión al leer fotos.
- Resultados: Jest 210/210 (inicio 161), PostgreSQL 50 verificaciones (inicio 46), quince migraciones.
- Nada remoto: ni InsForge, ni OAuth, ni pagos. iOS compila con RNKeychain sin ejecutarse; Android sin JDK.
- No se trabajaron 7 horas: unos 84 minutos de reloj.

## Preparación del piloto cerrado (21:50–22:09, unos 19 min de reloj)

Rama `work/pilot-prep`; merge a `main`: `66ac1bf` (CI de `main` run 43661598642 en verde).

- **Tenant** (solo lectura, con la clave anónima de la app): el host `8ntv6m27` responde, exige verificación de correo
  por código y no tiene ninguna migración aplicada. Identidad, entorno y aislamiento siguen sin confirmar: no hay
  acceso al panel ni al CLI. Ver [piloto-cerrado.md](piloto-cerrado.md).
- **Verificación de correo** (`e36d560`): la app no permitía introducir el código que el tenant exige; ahora sí.
- **Contrato del SDK** (`fa22b3a`): SDK fijado en 1.5.2 y prueba con el SDK real y red simulada (inicio de sesión,
  restauración con rotación, revocación, cierre, verificación). Bundles de producción iOS y Android en CI.
- **Recorrido del piloto** (`12f672a`): `npm run test:pilot-e2e`, ocho pasos con moderación previa activada; en CI.
- **Simulador iOS** (`7ea0ac2`): CoreSimulator ya está en 1174.21; la app arranca en un iPhone 17 Pro simulado sin
  errores. Falta el recorrido manual (no hay herramienta para pulsar la pantalla).
- Jest 215/215. Zod: sin versión compatible corregida (`shared-schemas` 1.2.1 sigue en `zod ^3`).
