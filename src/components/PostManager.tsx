import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import type { OwnPost, PostKind, saveOwnPost } from '../lib/platformService';
import { normalizeSocialLink } from '../utils/social';
import { ActionButton, Chip, Field, portalStyles as styles } from './PortalControls';

// Publicaciones e historias de una oferta para su proveedor. El servidor vuelve a validar propiedad, texto,
// enlace (solo permalinks de Instagram/TikTok) y el límite diario; toda alta o edición queda en revisión.

export const MAX_POST_LENGTH = 280;

export type PostManagerProps = {
  offerId: string | null;
  language: Language;
  load: () => Promise<OwnPost[]>;
  save: (input: Parameters<typeof saveOwnPost>[0]) => Promise<OwnPost>;
  remove: (postId: string) => Promise<void>;
  describeError: (error: unknown) => string;
};

export function PostManager({ offerId, language, load, save, remove, describeError }: PostManagerProps) {
  const words = portalCopy[language].posts;
  const [posts, setPosts] = useState<OwnPost[]>([]);
  const [kind, setKind] = useState<PostKind>('post');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // El portal recrea describeError en cada render: se guarda en una ref para no recargar en bucle.
  const describe = useRef(describeError);
  describe.current = describeError;

  const refresh = useCallback(async () => {
    try {
      setPosts(await load());
    } catch (error) {
      setNotice(describe.current(error));
    }
  }, [load]);

  useEffect(() => {
    if (offerId) refresh();
  }, [offerId, refresh]);

  if (!offerId) return null;
  const currentOfferId = offerId;
  const own = posts.filter(post => post.offer_id === currentOfferId);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      setNotice(success);
      await refresh();
      return true;
    } catch (error) {
      setNotice(describeError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const linkUrl = normalizeSocialLink(link);
    if (linkUrl === null) {
      setNotice(words.badLink);
      return;
    }
    if (!body.trim()) {
      setNotice(portalCopy[language].errors.invalid_post);
      return;
    }
    const ok = await act(() => save({ postId: null, offerId: currentOfferId, kind, body: body.trim(), linkUrl }), words.saved);
    if (ok) {
      setBody('');
      setLink('');
    }
  }

  return (
    <View style={styles.quote}>
      <Text style={styles.sectionTitle}>{words.title}</Text>
      <Text style={styles.helper}>{words.hint}</Text>
      {own.length ? own.map(post => (
        <View key={post.id} style={styles.eventRow}>
          <Text style={styles.offerName}>
            {post.kind === 'story' ? words.kindStory : words.kindPost} · {words.status[post.status]}
          </Text>
          <Text style={styles.helper}>{post.body}</Text>
          {post.link_url ? <Text selectable style={styles.id}>{post.link_url}</Text> : null}
          {post.status === 'rejected' && post.moderation_note ? <Text style={styles.helper}>{post.moderation_note}</Text> : null}
          <Pressable
            onPress={() => act(() => remove(post.id), words.removed)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${words.remove} ${post.body}`}
          >
            <Text style={styles.link}>{words.remove}</Text>
          </Pressable>
        </View>
      )) : <Text style={styles.helper}>{words.none}</Text>}
      <View style={styles.chips}>
        <Chip label={words.kindPost} selected={kind === 'post'} onPress={() => setKind('post')} />
        <Chip label={words.kindStory} selected={kind === 'story'} onPress={() => setKind('story')} />
      </View>
      <Field label={words.body} value={body} onChange={setBody} maxLength={MAX_POST_LENGTH} multiline />
      <Field label={words.link} value={link} onChange={setLink} maxLength={200} />
      <ActionButton title={words.save} onPress={submit} disabled={busy} />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.helper}>{notice}</Text> : null}
    </View>
  );
}
