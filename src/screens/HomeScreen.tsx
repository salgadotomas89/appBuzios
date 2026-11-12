import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { OfferRow } from '../components/OfferRow';
import { homeMock as data } from '../data/homeMock';
import type { Language, OfferCategory } from '../data/homeMock';
import { colors, radius } from '../theme';

const FOOTER_HEIGHT = 56;

const copy = {
  es: {
    title: 'Tu viaje a Búzios',
    offerSummary: 'experiencias para descubrir',
    savings: 'Hasta',
    categories: 'Elige tu plan',
    featured: 'Para disfrutar hoy',
    map: 'Mapa',
    seeOffers: 'Ver las ofertas',
  },
  pt: {
    title: 'Sua viagem a Búzios',
    offerSummary: 'experiências para descobrir',
    savings: 'Até',
    categories: 'Escolha seu passeio',
    featured: 'Para curtir hoje',
    map: 'Mapa',
    seeOffers: 'Ver ofertas',
  },
} satisfies Record<Language, Record<string, string>>;

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Language>('es');
  const [selectedCategory, setSelectedCategory] = useState<OfferCategory | null>(null);
  const text = copy[language];
  const visibleOffers = selectedCategory
    ? data.offers.filter(offer => offer.category === selectedCategory)
    : data.offers;

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
          <View>
            <Text style={styles.brand}>BÚZIOS FLOW</Text>
            <Text style={styles.locationLabel}>{data.locationLabel[language]}</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.languageToggle}>
              {(['es', 'pt'] as const).map(option => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: language === option }}
                  onPress={() => setLanguage(option)}
                  style={[
                    styles.languageButton,
                    language === option && styles.languageButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.languageText,
                      language === option && styles.languageTextActive,
                    ]}
                  >
                    {option.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          <Pressable style={styles.iconButton} hitSlop={8}>
            <Icon name="search" size={20} />
          </Pressable>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroKicker}>BÚZIOS · BRASIL</Text>
          <Text style={styles.heroTitle}>{text.title}</Text>
          <View style={styles.heroDetails}>
            <Text style={styles.heroSummary}>
              {data.activeOffers} {text.offerSummary}
            </Text>
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsText}>
                {text.savings} {data.maxDiscount}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{text.categories}</Text>
          <Text style={styles.sectionEyebrow}>04</Text>
        </View>
        <View style={styles.categoryFilters}>
          {data.categories.map(category => {
            const active = selectedCategory === category.id;
            return (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelectedCategory(active ? null : category.id)}
                style={[styles.categoryButton, active && styles.categoryButtonActive]}
              >
                <Text
                  style={[
                    styles.categoryText,
                    active && styles.categoryTextActive,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {category.label[language]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.sectionHeader, styles.offersHeader]}>
          <Text style={styles.sectionTitle}>{text.featured}</Text>
          <Text style={styles.offerCount}>{visibleOffers.length}</Text>
        </View>
        <View style={styles.insights}>
          {visibleOffers.map(offer => (
            <OfferRow key={offer.id} offer={offer} language={language} />
          ))}
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <Pressable style={[styles.footerButton, styles.footerSecondary]}>
          <Text style={styles.footerSecondaryText}>{text.map}</Text>
        </Pressable>
        <Pressable style={[styles.footerButton, styles.footerPrimary]}>
          <Text style={styles.footerPrimaryText}>
            {text.seeOffers} {data.activeOffers}
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
    marginTop: 3,
    fontSize: 12,
    color: colors.muted,
  },
  brand: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dark,
    letterSpacing: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  languageToggle: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  languageButton: {
    minWidth: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  languageButtonActive: {
    backgroundColor: colors.dark,
  },
  languageText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  languageTextActive: {
    color: colors.onDark,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    marginTop: 20,
    padding: 20,
    borderRadius: radius.card,
    backgroundColor: colors.dark,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.sand,
    letterSpacing: 1,
  },
  heroTitle: {
    marginTop: 12,
    fontSize: 31,
    lineHeight: 38,
    fontFamily: 'Georgia',
    color: colors.onDark,
  },
  heroDetails: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroSummary: {
    flexShrink: 1,
    fontSize: 12,
    color: colors.onDark,
  },
  savingsBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  savingsText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onDark,
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    fontVariant: ['tabular-nums'],
  },
  categoryFilters: {
    flexDirection: 'row',
    gap: 6,
  },
  categoryButton: {
    flex: 1,
    minWidth: 0,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  categoryButtonActive: {
    backgroundColor: colors.sea,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  categoryTextActive: {
    color: colors.onDark,
  },
  offersHeader: {
    marginTop: 24,
  },
  offerCount: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.sand,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  insights: {
    gap: 9,
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.sand,
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
