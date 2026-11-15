import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import type { OfferMedia } from '../lib/platformService';
import { checkImage, MAX_ALT_TEXT, MAX_IMAGES_PER_OFFER } from '../media/imagePolicy';
import { OfferMediaGatewayError, type CancelSignal, type GatewayFailure, type OfferMediaGateway } from '../media/offerMediaGateway';
import { pickPhotos, type PickedPhoto, type PickFailure, type PickResult, type PickSource } from '../media/photoPicker';
import { colors, radius } from '../theme';
import { ActionButton, portalStyles } from './PortalControls';

// Fotos de una oferta para su proveedor: elegir de la galería o con la cámara, vista previa, descripción
// obligatoria, subida con progreso y cancelación, y borrado con confirmación. Todo pasa por la función
// offer-media (gateway); nunca se escribe en el bucket. Las fotos existentes se leen por RLS (el dueño ve también
// las de ofertas sin aprobar) y se muestran con su sesión, porque la función solo sirve sin sesión las fotos de
// ofertas publicadas y aprobadas. Se sube una foto cada vez: la función admite dos a la vez por usuario.

declare const AbortController: new () => { signal: CancelSignal; abort(): void };

type Failure = GatewayFailure | PickFailure;
type Draft = PickedPhoto & {
  altText: string;
  status: 'ready' | 'invalid' | 'uploading' | 'failed';
  progress: number;
  error?: Failure;
};
type Notice = { text: string; tone: 'info' | 'error' };

export type OfferPhotoManagerProps = {
  offerId: string | null;
  language: Language;
  gateway: Pick<OfferMediaGateway, 'upload' | 'remove'>;
  loadMedia: (offerId: string) => Promise<OfferMedia[]>;
  getAccessToken: () => Promise<string | null>;
  pick?: (source: PickSource, limit: number) => Promise<PickResult>;
};

const failureOf = (error: unknown): Failure => (error instanceof OfferMediaGatewayError ? error.code : 'network');

export function OfferPhotoManager({ offerId, language, gateway, loadMedia, getAccessToken, pick = pickPhotos }: OfferPhotoManagerProps) {
  const words = portalCopy[language].photos;
  const errors = portalCopy[language].photoErrors;
  const [media, setMedia] = useState<OfferMedia[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const upload = useRef<{ localId: string; abort(): void } | null>(null);

  const refresh = useCallback(async () => {
    if (!offerId) return;
    try {
      const [list, current] = await Promise.all([loadMedia(offerId), getAccessToken()]);
      setMedia(list.filter(item => item.offer_id === offerId).sort((left, right) => left.position - right.position));
      setToken(current);
      setLoadFailed(false);
    } catch {
      setMedia([]);
      setLoadFailed(true);
    }
  }, [offerId, loadMedia, getAccessToken]);

  // Al cambiar de oferta se cancela la subida en curso y se descartan los borradores de la anterior.
  useEffect(() => {
    upload.current?.abort();
    setDrafts([]);
    setMedia(null);
    setNotice(null);
    setConfirming(null);
    refresh();
  }, [refresh]);
  useEffect(() => () => upload.current?.abort(), []);

  const updateDraft = (localId: string, change: Partial<Draft>) =>
    setDrafts(current => current.map(draft => (draft.localId === localId ? { ...draft, ...change } : draft)));
  const remaining = MAX_IMAGES_PER_OFFER - (media?.length ?? 0) - drafts.length;
  const uploading = drafts.some(draft => draft.status === 'uploading');
  const busy = uploading || picking || removing !== null;

  async function choose(source: PickSource) {
    if (remaining < 1) return;
    setPicking(true);
    setNotice(null);
    try {
      const result = await pick(source, remaining);
      if (result.status === 'failed') setNotice({ text: errors[result.error], tone: 'error' });
      if (result.status !== 'picked') return;
      setDrafts(current => [
        ...current,
        ...result.photos.slice(0, remaining).map(photo => {
          // Tipo, peso y medidas se comprueban ya; la descripción, al subir.
          const checked = checkImage({ ...photo, altText: 'x' });
          return checked.ok
            ? { ...photo, altText: '', status: 'ready' as const, progress: 0 }
            : { ...photo, altText: '', status: 'invalid' as const, progress: 0, error: checked.error };
        }),
      ]);
    } finally {
      setPicking(false);
    }
  }

  async function send(draft: Draft): Promise<boolean> {
    if (!offerId) return false;
    const controller = new AbortController();
    upload.current = { localId: draft.localId, abort: () => controller.abort() };
    updateDraft(draft.localId, { status: 'uploading', progress: 0, error: undefined });
    try {
      await gateway.upload(offerId, draft, {
        signal: controller.signal,
        onProgress: progress => updateDraft(draft.localId, { progress }),
      });
      setDrafts(current => current.filter(item => item.localId !== draft.localId));
      setNotice({ text: words.uploaded, tone: 'info' });
      await refresh();
      return true;
    } catch (error) {
      const failure = failureOf(error);
      if (failure === 'cancelled') {
        updateDraft(draft.localId, { status: 'ready', progress: 0 });
        setNotice({ text: words.cancelled, tone: 'info' });
        // Si el servidor ya la había recibido, la foto aparece en la lista y se puede eliminar.
        await refresh();
      } else {
        updateDraft(draft.localId, { status: 'failed', progress: 0, error: failure });
        setNotice({ text: errors[failure], tone: 'error' });
      }
      return false;
    } finally {
      if (upload.current?.localId === draft.localId) upload.current = null;
    }
  }

  async function sendAll() {
    for (const draft of drafts.filter(item => item.status === 'ready' || item.status === 'failed')) {
      if (!(await send(draft))) return;
    }
  }

  async function remove(mediaId: string) {
    setConfirming(null);
    setRemoving(mediaId);
    try {
      await gateway.remove(mediaId);
      setNotice({ text: words.removed, tone: 'info' });
      await refresh();
    } catch (error) {
      setNotice({ text: errors[failureOf(error)], tone: 'error' });
    } finally {
      setRemoving(null);
    }
  }

  const count = words.count.replace('{n}', String(media?.length ?? 0)).replace('{max}', String(MAX_IMAGES_PER_OFFER));
  const sendable = drafts.filter(draft => draft.status === 'ready' || draft.status === 'failed');

  return (
    <View style={portalStyles.section}>
      <Text style={portalStyles.sectionTitle} accessibilityRole="header">{words.title} · {count}</Text>
      <Text style={portalStyles.helper}>{words.hint}</Text>
      {!offerId ? (
        <Text style={portalStyles.helper}>{words.saveFirst}</Text>
      ) : media === null ? (
        <View style={portalStyles.busy} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.sea} accessibilityLabel={words.loading} />
          <Text style={portalStyles.helper}>{words.loading}</Text>
        </View>
      ) : (
        <>
          {loadFailed ? <Text style={styles.error}>{errors.network}</Text> : null}
          {media.length ? (
            <View style={styles.grid}>
              {media.map(item => (
                <View key={item.id} style={styles.tile}>
                  <Image
                    source={{ uri: item.url, headers: token ? { Authorization: `Bearer ${token}` } : undefined }}
                    accessible
                    accessibilityLabel={item.alt_text}
                    resizeMode="cover"
                    style={styles.thumb}
                  />
                  <Text style={portalStyles.helper} numberOfLines={2}>{item.alt_text}</Text>
                  {removing === item.id ? (
                    <ActivityIndicator color={colors.sea} accessibilityLabel={words.remove} />
                  ) : confirming === item.id ? (
                    <View style={styles.actions}>
                      <Text style={portalStyles.helper}>{words.confirmRemove}</Text>
                      <SmallButton label={words.confirm} onPress={() => remove(item.id)} danger />
                      <SmallButton label={words.keep} onPress={() => setConfirming(null)} />
                    </View>
                  ) : (
                    <SmallButton label={words.remove} hint={item.alt_text} onPress={() => setConfirming(item.id)} disabled={busy} />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={portalStyles.helper}>{words.empty}</Text>
          )}
          <View style={styles.actions}>
            <ActionButton title={words.fromLibrary} secondary onPress={() => choose('library')} disabled={busy || remaining < 1} />
            <ActionButton title={words.fromCamera} secondary onPress={() => choose('camera')} disabled={busy || remaining < 1} />
            {picking ? <ActivityIndicator color={colors.sea} /> : null}
          </View>
          {drafts.map(draft => (
            <View key={draft.localId} style={styles.draft}>
              <Image source={{ uri: draft.uri }} accessible accessibilityLabel={words.preview} resizeMode="cover" style={styles.preview} />
              <View style={portalStyles.flex}>
                <TextInput
                  value={draft.altText}
                  onChangeText={altText => updateDraft(draft.localId, { altText })}
                  accessibilityLabel={words.altLabel}
                  accessibilityHint={words.altHint}
                  placeholder={words.altLabel}
                  placeholderTextColor={colors.muted}
                  maxLength={MAX_ALT_TEXT}
                  editable={draft.status !== 'uploading' && draft.status !== 'invalid'}
                  style={portalStyles.input}
                />
                {draft.status === 'uploading' ? (
                  <>
                    <View
                      style={styles.track}
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel={words.progressLabel}
                      accessibilityValue={{ min: 0, max: 100, now: Math.round(draft.progress * 100) }}
                    >
                      <View style={[styles.bar, { width: `${Math.round(draft.progress * 100)}%` }]} />
                    </View>
                    <Text style={portalStyles.helper}>{words.uploading.replace('{percent}', String(Math.round(draft.progress * 100)))}</Text>
                    <SmallButton label={words.cancelUpload} onPress={() => upload.current?.abort()} />
                  </>
                ) : (
                  <>
                    {draft.error ? <Text style={styles.error}>{errors[draft.error]}</Text> : null}
                    <View style={styles.actions}>
                      {draft.status !== 'invalid' ? (
                        <SmallButton
                          label={draft.status === 'failed' ? words.retry : words.upload}
                          onPress={() => send(draft)}
                          disabled={busy || !draft.altText.trim()}
                        />
                      ) : null}
                      <SmallButton
                        label={words.discard}
                        onPress={() => setDrafts(current => current.filter(item => item.localId !== draft.localId))}
                      />
                    </View>
                  </>
                )}
              </View>
            </View>
          ))}
          {sendable.length > 1 ? (
            <ActionButton title={words.uploadAll} onPress={sendAll} disabled={busy || sendable.some(draft => !draft.altText.trim())} />
          ) : null}
        </>
      )}
      {notice ? (
        <Text
          style={notice.tone === 'error' ? styles.error : portalStyles.message}
          accessibilityLiveRegion="polite"
          accessibilityRole={notice.tone === 'error' ? 'alert' : 'text'}
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

function SmallButton({ label, onPress, disabled = false, danger = false, hint }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; hint?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.small, danger && styles.danger, disabled && portalStyles.disabled]}
    >
      <Text style={[portalStyles.textButtonLabel, danger && styles.dangerLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 150, gap: 5 },
  thumb: { width: 150, height: 100, borderRadius: radius.card, backgroundColor: colors.track },
  draft: { flexDirection: 'row', gap: 10, padding: 10, borderWidth: 1, borderColor: colors.track, borderRadius: radius.card, backgroundColor: colors.card },
  preview: { width: 88, height: 88, borderRadius: radius.card, backgroundColor: colors.track },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.sea },
  small: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radius.card, borderWidth: 1, borderColor: colors.track, backgroundColor: colors.card },
  danger: { borderColor: '#B4472C' },
  dangerLabel: { color: '#B4472C' },
  error: { color: '#8A2F1B', backgroundColor: '#FCE6DF', padding: 11, borderRadius: radius.card, fontSize: 12, lineHeight: 18 },
});
