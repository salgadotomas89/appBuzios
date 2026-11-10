import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Offer } from '../data/homeMock';
import { colors, radius } from '../theme';
import { brl, discountPercent } from '../utils/format';
import { Icon } from './Icon';

type Props = { offer: Offer; onPress?: () => void };

export function OfferRow({ offer, onPress }: Props) {
  const accent = offer.tone === 'accent';
  const discount = discountPercent(offer.price, offer.originalPrice);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: accent ? colors.accent : colors.iconSoft },
        ]}
      >
        <Icon name={offer.icon} size={20} color={colors.text} />
      </View>
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {offer.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {offer.subtitle}
        </Text>
      </View>
      <View style={styles.priceCol}>
        <Text style={styles.price}>{brl(offer.price)}</Text>
        {discount > 0 ? (
          <Text style={styles.discount}>-{discount}%</Text>
        ) : (
          <Icon name="chevron" size={16} color={colors.muted} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingLeft: 12,
    paddingRight: 16,
    gap: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  priceCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  price: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  discount: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
});
