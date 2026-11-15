import React from 'react';
import { Image, Text, TextInput } from 'react-native';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { OfferPhotoManager } from '../src/components/OfferPhotoManager';
import type { MediaModerationStatus, OwnOfferMedia } from '../src/lib/platformService';
import { OfferMediaGatewayError, type CancelSignal, type TransportOptions } from '../src/media/offerMediaGateway';
import type { PickResult } from '../src/media/photoPicker';
import type { ImageCandidate } from '../src/media/imagePolicy';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

const OFFER = '11111111-1111-4111-8111-111111111111';
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

function media(id: string, alt: string, position = 0, moderation_status: MediaModerationStatus = 'approved', moderation_note = ''): OwnOfferMedia {
  return { id, offer_id: OFFER, url: `https://f/offer-media/offers/${OFFER}/${id}.jpg`, content_type: 'image/jpeg', width: 1200, height: 800, alt_text: alt, position, moderation_status, moderation_note };
}
function picked(...sizes: [number, number][]): PickResult {
  return { status: 'picked', photos: sizes.map(([width, height], index) => ({ localId: `l${index}`, uri: `file:///p${index}.jpg`, bytes: jpeg, width, height })) };
}

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));
// El elemento con rol de botón y onPress (Pressable) cuyo texto es exactamente `label`.
const button = (root: ReactTestInstance, label: string) =>
  root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' &&
    node.findAllByType(Text).some(text => flatten(text.props.children) === label))[0];
const flush = () => act(async () => { await new Promise<void>(resolve => setTimeout(() => resolve(), 0)); });

async function render(options: {
  list?: OwnOfferMedia[];
  pick?: PickResult;
  upload?: (offerId: string, candidate: ImageCandidate, transport: TransportOptions) => Promise<unknown>;
  remove?: (id: string) => Promise<void>;
  language?: 'es' | 'pt' | 'en';
  offerId?: string | null;
}) {
  let list = options.list ?? [];
  const gateway = {
    upload: jest.fn(options.upload ?? (async () => ({ id: 'new' }))),
    remove: jest.fn(options.remove ?? (async (id: string) => { list = list.filter(item => item.id !== id); })),
  };
  const loadMedia = jest.fn(async () => list);
  const pick = jest.fn(async () => options.pick ?? { status: 'cancelled' as const });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <OfferPhotoManager
        offerId={options.offerId === undefined ? OFFER : options.offerId}
        language={options.language ?? 'es'}
        gateway={gateway as never}
        loadMedia={loadMedia}
        getAccessToken={async () => 'owner-jwt'}
        pick={pick}
      />,
    );
  });
  await flush();
  return { root: renderer.root, gateway, loadMedia, pick, setList: (next: OwnOfferMedia[]) => { list = next; } };
}

it('asks to save the offer first and does not load anything without an offer', async () => {
  const { root, loadMedia } = await render({ offerId: null });
  expect(texts(root)).toContain('Guarda la oferta antes de añadir fotos.');
  expect(loadMedia).not.toHaveBeenCalled();
});

it('shows the existing photos with their description, loaded with the owner session', async () => {
  const { root } = await render({ list: [media('b', 'Piscina', 1), media('a', 'Varanda', 0)] });
  const images = root.findAllByType(Image);
  expect(images.map(image => [image.props.accessibilityLabel, image.props.source.headers])).toEqual([
    ['Varanda', { Authorization: 'Bearer owner-jwt' }],
    ['Piscina', { Authorization: 'Bearer owner-jwt' }],
  ]);
  expect(texts(root)).toContain('Fotos de la oferta · 2 de 10');
});

it('previews a picked photo, requires a description and uploads it with progress', async () => {
  let report: ((value: number) => void) | undefined;
  let finish: (() => void) | undefined;
  const { root, gateway, pick, loadMedia, setList } = await render({
    pick: picked([1600, 1200]),
    upload: (_offer, _candidate, transport) => new Promise(resolve => { report = transport.onProgress; finish = () => resolve({ id: 'm1' }); }),
  });
  await act(async () => { button(root, 'Elegir de la galería').props.onPress(); });
  expect(pick).toHaveBeenCalledWith('library', 10);
  expect(root.findAllByType(Image).map(image => image.props.accessibilityLabel)).toEqual(['Vista previa de la foto nueva']);
  expect(button(root, 'Subir').props.disabled).toBe(true);

  await act(async () => { root.findByType(TextInput).props.onChangeText('Quarto com varanda'); });
  await act(async () => { button(root, 'Subir').props.onPress(); });
  expect(gateway.upload).toHaveBeenCalledWith(OFFER, expect.objectContaining({ altText: 'Quarto com varanda', width: 1600, bytes: jpeg }), expect.anything());
  await act(async () => { report?.(0.42); });
  const bar = root.find(node => node.props.accessibilityRole === 'progressbar' && typeof node.type === 'string');
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  expect(texts(root)).toContain('Subiendo… 42 %');
  expect(button(root, 'Elegir de la galería').props.disabled).toBe(true);

  setList([media('m1', 'Quarto com varanda', 0, 'pending')]);
  await act(async () => { finish?.(); });
  await flush();
  expect(texts(root)).toContain('Foto enviada. La administración la revisará antes de publicarla.');
  expect(root.findAllByType(TextInput)).toHaveLength(0);
  expect(root.findAllByType(Image).map(image => image.props.accessibilityLabel)).toEqual(['Quarto com varanda']);
  expect(loadMedia).toHaveBeenCalledTimes(2);
});

it('flags photos that are too small before uploading and lets the provider discard them', async () => {
  const { root, gateway } = await render({ pick: picked([400, 300]), language: 'pt' });
  await act(async () => { button(root, 'Escolher da galeria').props.onPress(); });
  expect(texts(root)).toContain('A foto deve ter entre 600 e 6000 px por lado.');
  expect(button(root, 'Enviar')).toBeUndefined();
  await act(async () => { button(root, 'Remover').props.onPress(); });
  expect(root.findAllByType(TextInput)).toHaveLength(0);
  expect(gateway.upload).not.toHaveBeenCalled();
});

it('cancels an upload in flight, keeps the photo ready and re-reads the list', async () => {
  let signal: CancelSignal | undefined;
  const { root, loadMedia } = await render({
    pick: picked([1600, 1200]),
    upload: (_offer, _candidate, transport) => new Promise((_resolve, reject) => {
      signal = transport.signal;
      transport.signal?.addEventListener('abort', () => reject(new OfferMediaGatewayError('cancelled')));
    }),
  });
  await act(async () => { button(root, 'Elegir de la galería').props.onPress(); });
  await act(async () => { root.findByType(TextInput).props.onChangeText('Vista'); });
  await act(async () => { button(root, 'Subir').props.onPress(); });
  await act(async () => { button(root, 'Cancelar subida').props.onPress(); });
  await flush();
  expect(signal?.aborted).toBe(true);
  expect(texts(root)).toContain('Subida cancelada.');
  expect(button(root, 'Subir').props.disabled).toBe(false);
  expect(loadMedia).toHaveBeenCalledTimes(2);
});

it('shows translated server errors and offers a retry', async () => {
  const { root } = await render({ pick: picked([1600, 1200]), language: 'en', upload: async () => { throw new OfferMediaGatewayError('rate_limited'); } });
  await act(async () => { button(root, 'Choose from gallery').props.onPress(); });
  await act(async () => { root.findByType(TextInput).props.onChangeText('Pool'); });
  await act(async () => { button(root, 'Upload').props.onPress(); });
  await flush();
  expect(texts(root).filter(text => text === 'You uploaded many photos in a short time. Wait a while and try again.')).toHaveLength(2);
  const alert = root.find(node => node.type === Text && node.props.accessibilityRole === 'alert');
  expect(alert.props.accessibilityLiveRegion).toBe('polite');
  expect(button(root, 'Try again')).toBeDefined();
});

it('reports a missing camera or permission in the chosen language', async () => {
  const { root } = await render({ pick: { status: 'failed', error: 'camera_unavailable' } });
  await act(async () => { button(root, 'Tomar foto').props.onPress(); });
  expect(texts(root)).toContain('Este dispositivo no tiene cámara disponible.');
});

it('deletes a photo only after confirming and through the function', async () => {
  const { root, gateway } = await render({ list: [media('a', 'Varanda')] });
  await act(async () => { button(root, 'Eliminar').props.onPress(); });
  expect(gateway.remove).not.toHaveBeenCalled();
  await act(async () => { button(root, 'No').props.onPress(); });
  await act(async () => { button(root, 'Eliminar').props.onPress(); });
  await act(async () => { button(root, 'Sí, eliminar').props.onPress(); });
  await flush();
  expect(gateway.remove).toHaveBeenCalledWith('a');
  expect(texts(root)).toContain('Foto eliminada.');
  expect(texts(root)).toContain('Esta oferta todavía no tiene fotos.');
});

it('stops offering new photos at ten and only asks the picker for the free slots', async () => {
  const nine = Array.from({ length: 9 }, (_, index) => media(`m${index}`, `Foto ${index}`, index));
  const { root, pick } = await render({ list: nine, pick: picked([1600, 1200], [1600, 1200]) });
  await act(async () => { button(root, 'Elegir de la galería').props.onPress(); });
  expect(pick).toHaveBeenCalledWith('library', 1);
  expect(button(root, 'Elegir de la galería').props.disabled).toBe(true);
  expect(button(root, 'Tomar foto').props.disabled).toBe(true);
});

it('shows the provider the review status of each photo and why one was rejected', async () => {
  const { root } = await render({ language: 'pt', list: [
    media('a', 'Varanda', 0, 'approved'),
    media('b', 'Piscina', 1, 'pending'),
    media('c', 'Hóspedes', 2, 'rejected', 'Mostra rostos sem autorização'),
  ] });
  const all = texts(root);
  expect(all).toEqual(expect.arrayContaining(['Publicada', 'Aguardando revisão', 'Recusada', 'Motivo: Mostra rostos sem autorização']));
});

it('keeps the photo after losing the connection and uploads it on retry', async () => {
  let attempts = 0;
  const { root, gateway } = await render({
    pick: picked([1600, 1200]),
    upload: async () => {
      attempts += 1;
      if (attempts === 1) throw new OfferMediaGatewayError('network');
      return { id: 'm1' };
    },
  });
  await act(async () => { button(root, 'Elegir de la galería').props.onPress(); });
  await act(async () => { root.findByType(TextInput).props.onChangeText('Vista do mar'); });
  await act(async () => { button(root, 'Subir').props.onPress(); });
  await flush();
  expect(texts(root)).toContain('Sin conexión con el servidor. Inténtalo de nuevo.');
  expect(root.findByType(TextInput).props.value).toBe('Vista do mar');
  await act(async () => { button(root, 'Reintentar').props.onPress(); });
  await flush();
  expect(gateway.upload).toHaveBeenCalledTimes(2);
  expect(texts(root)).toContain('Foto enviada. La administración la revisará antes de publicarla.');
});

it('explains that a HEIC photo that was not converted cannot be uploaded', async () => {
  const heic = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
  const { root, gateway } = await render({ pick: { status: 'picked', photos: [{ localId: 'h', uri: 'file:///IMG_0001.HEIC', bytes: heic, width: 4032, height: 3024 }] } });
  await act(async () => { button(root, 'Elegir de la galería').props.onPress(); });
  expect(texts(root)).toContain('Solo se aceptan fotos JPEG, PNG o WebP.');
  expect(button(root, 'Subir')).toBeUndefined();
  expect(gateway.upload).not.toHaveBeenCalled();
});
