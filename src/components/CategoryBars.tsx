import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CategoryStat, Language } from '../data/homeMock';
import { colors, radius } from '../theme';

const TRACK_HEIGHT = 150;
const MAX_FILL = 118;

type Props = { categories: CategoryStat[]; language: Language };

export function CategoryBars({ categories, language }: Props) {
  const [barWidth, setBarWidth] = useState(0);
  const max = Math.max(...categories.map(c => c.count));

  return (
    <View style={styles.row}>
      {categories.map((c, i) => {
        // El relleno nunca es más bajo que el ancho: así queda como círculo.
        const fill = Math.max((c.count / max) * MAX_FILL, barWidth);
        return (
          <View key={c.id} style={styles.column}>
            <View
              style={styles.track}
              onLayout={
                i === 0 ? e => setBarWidth(e.nativeEvent.layout.width) : undefined
              }
            >
              <View
                style={[
                  styles.fill,
                  {
                    height: fill,
                    backgroundColor: c.highlight ? colors.dark : colors.accent,
                  },
                ]}
              />
              <View style={[styles.labelWrap, { bottom: fill - 6 }]}>
                <View
                  style={[
                    styles.label,
                    c.highlight ? styles.labelLight : styles.labelDark,
                  ]}
                >
                  <Text
                    style={[
                      styles.labelText,
                      { color: c.highlight ? colors.text : colors.onDark },
                    ]}
                  >
                    {c.count}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.caption} numberOfLines={1} adjustsFontSizeToFit>
              {c.label[language]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  track: {
    width: '100%',
    height: TRACK_HEIGHT,
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    justifyContent: 'flex-end',
  },
  fill: {
    width: '100%',
    borderRadius: radius.pill,
  },
  labelWrap: {
    position: 'absolute',
    left: -6,
    right: -6,
    alignItems: 'center',
  },
  label: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  labelDark: {
    backgroundColor: colors.dark,
  },
  labelLight: {
    backgroundColor: colors.card,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    marginTop: 12,
    fontSize: 13,
    color: colors.muted,
  },
});
