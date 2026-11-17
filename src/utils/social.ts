// Enlaces a publicaciones de Instagram o TikTok. Mismas reglas que connectical_social_platform (migración
// 202611170003): solo https, dominios oficiales y forma de permalink conocida. Se quitan los parámetros de
// seguimiento (?igsh=…, ?utm_…) y el fragmento antes de validar, porque el servidor no los admite.

export type SocialPlatform = 'instagram' | 'tiktok';

export const SOCIAL_LINK_PATTERNS: Record<SocialPlatform, RegExp[]> = {
  instagram: [/^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]{5,40}\/?$/],
  tiktok: [
    /^https:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,24}\/video\/[0-9]{8,25}\/?$/,
    /^https:\/\/vm\.tiktok\.com\/[A-Za-z0-9]{5,15}\/?$/,
  ],
};

export function socialPlatform(url: string): SocialPlatform | null {
  for (const platform of Object.keys(SOCIAL_LINK_PATTERNS) as SocialPlatform[]) {
    if (SOCIAL_LINK_PATTERNS[platform].some(pattern => pattern.test(url))) return platform;
  }
  return null;
}

// '' = sin enlace (válido). null = enlace no admitido.
export function normalizeSocialLink(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withoutExtras = trimmed.replace(/[?#].*$/, '');
  return socialPlatform(withoutExtras) ? withoutExtras : null;
}
