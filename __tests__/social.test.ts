import { normalizeSocialLink, socialPlatform, SOCIAL_LINK_PATTERNS } from '../src/utils/social';

declare const __dirname: string;
const fs: { readFileSync(path: string, encoding: 'utf8'): string } = require('fs');

it('uses exactly the permalink patterns of connectical_social_platform', () => {
  const sql = fs.readFileSync(`${__dirname}/../supabase/migrations/202611170003_offer_posts.sql`, 'utf8');
  const sqlPatterns = [...sql.matchAll(/when p_url ~ '([^']+)' then '(\w+)'/g)].map(match => `${match[2]}:${match[1]}`);
  const tsPatterns = Object.entries(SOCIAL_LINK_PATTERNS).flatMap(([platform, patterns]) =>
    patterns.map(pattern => `${platform}:${pattern.source.replace(/\\\//g, '/')}`));
  expect(tsPatterns).toEqual(sqlPatterns);
});

it('recognises Instagram and TikTok permalinks', () => {
  expect(socialPlatform('https://www.instagram.com/p/AbCdEf123/')).toBe('instagram');
  expect(socialPlatform('https://instagram.com/reel/AbCdEf123')).toBe('instagram');
  expect(socialPlatform('https://www.tiktok.com/@buzios.lab/video/7312345678901234567')).toBe('tiktok');
  expect(socialPlatform('https://vm.tiktok.com/ZMabc123/')).toBe('tiktok');
});

it('rejects other hosts, plain http, profiles and script URLs', () => {
  for (const url of [
    'http://instagram.com/p/AbCdEf123/',
    'https://evil.example/instagram.com/p/AbCdEf123/',
    'https://instagram.com.evil.example/p/AbCdEf123/',
    'https://www.instagram.com/buzios.lab/',
    'https://www.tiktok.com/@lab/photo/12345678901',
    // eslint-disable-next-line no-script-url -- caso de prueba: debe rechazarse
    'javascript:alert(1)',
  ]) {
    expect(socialPlatform(url)).toBeNull();
  }
});

it('strips tracking parameters and fragments before validating', () => {
  expect(normalizeSocialLink(' https://www.instagram.com/p/AbCdEf123/?igsh=abc&utm_source=x#top ')).toBe('https://www.instagram.com/p/AbCdEf123/');
  expect(normalizeSocialLink('   ')).toBe('');
  expect(normalizeSocialLink('https://example.com/p/AbCdEf123/')).toBeNull();
});
