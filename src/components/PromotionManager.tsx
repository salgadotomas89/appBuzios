import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { inputErrorText, portalCopy } from '../i18n/portalCopy';
import type { ProviderPromotion, saveProviderPromotion } from '../lib/reservationService';
import { colors, radius } from '../theme';
import { parseIsoDate, parsePercentToBps } from '../utils/portalInput';
import { ActionButton, Field, formatBps, portalStyles } from './PortalControls';

// Promociones de una oferta para su proveedor: crear por fechas de servicio y desactivar. El servidor
// (connectical_provider_save_promotion) valida de nuevo propiedad, límites (1-90 %, máximo un año) y solapes.

export const MIN_PROMOTION_BPS = 100;
export const MAX_PROMOTION_BPS = 9000;
const MAX_LABEL = 60;

type SaveInput = Parameters<typeof saveProviderPromotion>[0];

export type PromotionManagerProps = {
  offerId: string | null;
  language: Language;
  today: string;
  load: (offerId: string) => Promise<ProviderPromotion[]>;
  save: (input: SaveInput) => Promise<ProviderPromotion>;
  describeError: (error: unknown) => string;
};

type Notice = { text: string; tone: 'info' | 'error' };

// Validación local: devuelve el texto del error o los datos listos para la RPC.
export function readPromotionForm(
  language: Language,
  form: { percent: string; startsOn: string; endsOn: string },
  today: string,
): { ok: true; value: { percentOffBps: number; startsOn: string; endsOn: string } } | { ok: false; error: string } {
  const words = portalCopy[language];
  const percent = parsePercentToBps(form.percent);
  if (!percent.ok) return { ok: false, error: inputErrorText(language, words.promotions.percent, percent.error) };
  if (percent.value === null || percent.value < MIN_PROMOTION_BPS || percent.value > MAX_PROMOTION_BPS) {
    return { ok: false, error: words.errors.invalid_promotion };
  }
  const startsOn = parseIsoDate(form.startsOn, today);
  if (!startsOn.ok) return { ok: false, error: inputErrorText(language, words.promotions.startsOn, startsOn.error) };
  const endsOn = parseIsoDate(form.endsOn, today);
  if (!endsOn.ok) return { ok: false, error: inputErrorText(language, words.promotions.endsOn, endsOn.error) };
  if (endsOn.value < startsOn.value) return { ok: false, error: words.promotions.endsBeforeStart };
  return { ok: true, value: { percentOffBps: percent.value, startsOn: startsOn.value, endsOn: endsOn.value } };
}

export function PromotionManager({ offerId, language, today, load, save, describeError }: PromotionManagerProps) {
  const words = portalCopy[language].promotions;
  const [items, setItems] = useState<ProviderPromotion[] | null>(null);
  const [form, setForm] = useState({ percent: '', startsOn: today, endsOn: today, label: '' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!offerId) return;
    try {
      setItems(await load(offerId));
    } catch {
      setItems(null);
      setNotice({ text: words.loadFailed, tone: 'error' });
    }
  }, [load, offerId, words.loadFailed]);

  useEffect(() => {
    setItems(null);
    setNotice(null);
    refresh();
  }, [refresh]);

  if (!offerId) {
    return (
      <View style={styles.box}>
        <Text style={portalStyles.sectionTitle}>{words.title}</Text>
        <Text style={portalStyles.helper}>{words.needsOffer}</Text>
      </View>
    );
  }
  const currentOfferId = offerId;

  async function submit(input: SaveInput, success: string) {
    setBusy(true);
    try {
      await save(input);
      setNotice({ text: success, tone: 'info' });
      await refresh();
      return true;
    } catch (error) {
      setNotice({ text: describeError(error), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const parsed = readPromotionForm(language, form, today);
    if (!parsed.ok) {
      setNotice({ text: parsed.error, tone: 'error' });
      return;
    }
    const saved = await submit(
      { promotionId: null, offerId: currentOfferId, ...parsed.value, label: form.label.trim(), active: true },
      words.saved,
    );
    if (saved) setForm({ percent: '', startsOn: today, endsOn: today, label: '' });
  }

  function deactivate(item: ProviderPromotion) {
    submit(
      {
        promotionId: item.id,
        offerId: currentOfferId,
        percentOffBps: item.percent_off_bps,
        startsOn: item.starts_on,
        endsOn: item.ends_on,
        label: item.label,
        active: false,
      },
      words.deactivated,
    );
  }

  return (
    <View style={styles.box}>
      <Text style={portalStyles.sectionTitle}>{words.title}</Text>
      <Text style={portalStyles.helper}>{words.hint}</Text>
      {items?.length === 0 ? <Text style={portalStyles.helper}>{words.none}</Text> : null}
      {items?.map(item => (
        <View key={item.id} style={portalStyles.row}>
          <View style={portalStyles.flex}>
            <Text style={portalStyles.offerName}>
              −{formatBps(item.percent_off_bps)} · {item.starts_on} → {item.ends_on}
            </Text>
            <Text style={portalStyles.helper}>
              {item.label ? `${item.label} · ` : ''}
              {item.active ? words.active : words.inactive}
            </Text>
          </View>
          {item.active ? (
            <ActionButton title={words.deactivate} secondary onPress={() => deactivate(item)} disabled={busy} />
          ) : null}
        </View>
      ))}
      <Field label={words.percent} value={form.percent} onChange={percent => setForm(current => ({ ...current, percent }))} decimal />
      <Field label={words.startsOn} value={form.startsOn} onChange={startsOn => setForm(current => ({ ...current, startsOn }))} />
      <Field label={words.endsOn} value={form.endsOn} onChange={endsOn => setForm(current => ({ ...current, endsOn }))} />
      <Field label={words.label} value={form.label} onChange={label => setForm(current => ({ ...current, label }))} maxLength={MAX_LABEL} />
      <ActionButton title={words.save} onPress={create} disabled={busy} />
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={[portalStyles.helper, notice.tone === 'error' && styles.error]}>
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 12, padding: 12, gap: 6, backgroundColor: colors.card, borderRadius: radius.card },
  error: { color: colors.accent, fontWeight: '700' },
});
