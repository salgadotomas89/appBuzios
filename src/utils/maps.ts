// Enlace "Cómo llegar" sin SDK ni clave de mapas: URL universal de Apple Maps (iOS) o Google Maps (resto), que
// abre la app de mapas instalada o su web. Busca el punto de encuentro si existe y, si no, la ubicación, siempre
// acotada a Búzios para que "Porto da Barra" no lleve a otra ciudad.
export function directionsQuery(place: string): string {
  const trimmed = place.trim();
  return /b[uú]zios/i.test(trimmed) ? `${trimmed}, RJ, Brasil` : `${trimmed}, Armação dos Búzios, RJ, Brasil`;
}

export function mapsUrl(place: string, os: string): string {
  const query = encodeURIComponent(directionsQuery(place));
  return os === 'ios' ? `https://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
}
