# Contenido dinámico y redes sociales

Estado al 17-11-2026: **implementado y probado en local** (migración `202611170003_offer_posts`, sin aplicar).

## Qué hay

- **Publicaciones e historias de ofertas.** El proveedor activo escribe un texto (1-280 caracteres) sobre una oferta
  propia y, si quiere, pega el enlace permanente de una publicación suya en Instagram (`/p/`, `/reel/`, `/tv/`) o
  TikTok (`@cuenta/video/…`, `vm.tiktok.com/…`). El servidor deduce la plataforma y rechaza cualquier otro enlace.
- **Moderación previa.** Todo lo nuevo o editado queda en revisión; la administración aprueba o rechaza con motivo
  (sección «Novedades» de la consola). Cada decisión queda en la auditoría. Una historia es visible 24 horas desde
  su aprobación. Límite de 10 altas por proveedor y día.
- **Feed público** (`connectical_list_feed`, también sin sesión) en la portada cuando el catálogo compartido está
  activo: solo publicaciones aprobadas, vigentes, de ofertas visibles y proveedores activos.

## Por qué así (mecanismos oficialmente admitidos)

- La app **no descarga, copia ni incrusta** contenido de Instagram o TikTok y **no usa credenciales** de esas redes:
  abre el permalink con `Linking.openURL`, lo que abre la app oficial o su web. Es un uso normal de un enlace público.
- No hay scraping ni lectura de perfiles. El texto que se muestra lo escribe el proveedor en Búzios Flow.

## Próximo paso (bloqueado por decisiones externas)

| Integración | Requisito | Estado |
| --- | --- | --- |
| Vista previa incrustada de Instagram | App de Meta con *oEmbed Read* aprobada y token de app en un secreto del backend; la llamada debe hacerse desde una función del servidor, nunca desde el móvil | Bloqueado: sin app de Meta |
| Vista previa incrustada de TikTok | Endpoint oEmbed público de TikTok, respetando sus términos de uso; llamada desde una función del servidor con caché | Pendiente de revisión legal de términos |
| Publicar desde Búzios Flow en las redes del proveedor | Instagram Graph API (cuenta profesional + permisos de publicación) / TikTok Content Posting API (auditoría de la app) | No previsto para el MVP |
| Verificar que el enlace es de la cuenta del proveedor | Hoy lo comprueba a mano la administración al moderar; automatizarlo exige las APIs anteriores | Manual |
