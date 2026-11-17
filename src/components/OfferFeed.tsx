import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Language, Offer } from '../data/homeMock';
import { SHARED_OFFER_PREFIX } from '../data/catalog';
import { portalCopy } from '../i18n/portalCopy';
import type { FeedPost } from '../lib/platformService';
import { colors, radius } from '../theme';
import { socialPlatform } from '../utils/social';

// Novedades moderadas de los proveedores. El enlace se abre en Instagram o TikTok (o su web) con Linking: la app
// no descarga ni incrusta contenido de terceros. Se vuelve a validar el enlace antes de abrirlo.
export function OfferFeed({
  posts,
  offers,
  language,
  onOffer,
  openUrl = url => Linking.openURL(url),
}: {
  posts: FeedPost[];
  offers: Offer[];
  language: Language;
  onOffer: (offer: Offer) => void;
  openUrl?: (url: string) => Promise<unknown>;
}) {
  const words = portalCopy[language].posts;
  const byId = new Map(offers.map(offer => [offer.id, offer]));
  const visible = posts
    .map(post => ({ post, offer: byId.get(`${SHARED_OFFER_PREFIX}${post.offer_id}`) }))
    .filter((item): item is { post: FeedPost; offer: Offer } => item.offer !== undefined);
  if (!visible.length) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{words.feedTitle}</Text>
      {visible.map(({ post, offer }) => {
        const platform = post.link_url ? socialPlatform(post.link_url) : null;
        return (
          <View key={post.id} style={styles.card}>
            <Text style={styles.offer}>
              {post.kind === 'story' ? `${words.story} · ` : ''}
              {offer.title[language]}
            </Text>
            <Text style={styles.body}>{post.body}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => onOffer(offer)} accessibilityRole="button" accessibilityLabel={`${words.seeOffer} ${offer.title[language]}`}>
                <Text style={styles.link}>{words.seeOffer}</Text>
              </Pressable>
              {platform && post.link_url ? (
                <Pressable
                  onPress={() => {
                    openUrl(post.link_url as string).catch(() => undefined);
                  }}
                  accessibilityRole="link"
                >
                  <Text style={styles.link}>{platform === 'instagram' ? words.openInstagram : words.openTiktok}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 8 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  card: { padding: 12, gap: 6, backgroundColor: colors.card, borderRadius: radius.card },
  offer: { fontSize: 13, fontWeight: '700', color: colors.dark },
  body: { fontSize: 14, lineHeight: 20, color: colors.text },
  actions: { flexDirection: 'row', gap: 16 },
  link: { color: colors.sea, fontSize: 13, fontWeight: '800', paddingVertical: 6 },
});
