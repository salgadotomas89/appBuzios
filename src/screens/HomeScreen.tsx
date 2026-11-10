import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryBars } from '../components/CategoryBars';
import { Icon } from '../components/Icon';
import { OfferRow } from '../components/OfferRow';
import { homeMock as data } from '../data/homeMock';
import { colors, radius } from '../theme';

const FOOTER_HEIGHT = 56;

export function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + FOOTER_HEIGHT + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={styles.locationLabel}>{data.locationLabel}</Text>
          <Pressable style={styles.iconButton} hitSlop={8}>
            <Icon name="search" size={20} />
          </Pressable>
        </View>

        <Text style={styles.overline}>OFERTAS EN BÚZIOS HOY</Text>
        <Text style={styles.amountRow}>
          <Text style={styles.amount}>{data.activeOffers}</Text>
          <Text style={styles.amountCents}> ofertas activas</Text>
        </Text>
        <Text style={styles.summary}>
          Ahorra{' '}
          <Text style={styles.summaryStrong}>hasta {data.maxDiscount}%</Text> ·{' '}
          {data.places}
        </Text>

        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Ofertas por{'\n'}categoría</Text>
            <Text style={styles.chartNote}>{data.categoriesNote}</Text>
          </View>
          <CategoryBars categories={data.categories} />
        </View>

        <Text style={styles.sectionTitle}>Destacadas de hoy</Text>
        <View style={styles.insights}>
          {data.offers.map(offer => (
            <OfferRow key={offer.id} offer={offer} />
          ))}
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <Pressable style={[styles.footerButton, styles.footerSecondary]}>
          <Text style={styles.footerSecondaryText}>Mapa</Text>
        </Pressable>
        <Pressable style={[styles.footerButton, styles.footerPrimary]}>
          <Text style={styles.footerPrimaryText}>
            Ver las {data.activeOffers} ofertas
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overline: {
    marginTop: 18,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
  },
  amountRow: {
    marginTop: 6,
  },
  amount: {
    fontSize: 52,
    fontWeight: '500',
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  amountCents: {
    fontSize: 20,
    color: colors.muted,
  },
  summary: {
    marginTop: 12,
    fontSize: 14,
    color: colors.muted,
  },
  summaryStrong: {
    color: colors.text,
    fontWeight: '500',
  },
  chartCard: {
    marginTop: 22,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  chartNote: {
    flexShrink: 1,
    maxWidth: 140,
    fontSize: 12,
    color: colors.muted,
  },
  sectionTitle: {
    marginTop: 26,
    marginBottom: 12,
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
  },
  insights: {
    gap: 8,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: colors.background,
  },
  footerButton: {
    height: FOOTER_HEIGHT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSecondary: {
    flex: 1,
    backgroundColor: colors.card,
  },
  footerPrimary: {
    flex: 1.85,
    backgroundColor: colors.dark,
  },
  footerSecondaryText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  footerPrimaryText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.onDark,
  },
});
