import { base64ToBytes, pickPhotos, type Launchers } from '../src/media/photoPicker';
import { offerMediaFunctionUrl } from '../src/media/offerPhotos';
import { functionsBaseUrl } from '../functions/offer-media';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

declare const Buffer: { from(input: Uint8Array | string, encoding?: string): { toString(encoding: string): string } & ArrayLike<number> };

function launchers(response: object): Launchers & { calls: { source: string; options: Record<string, unknown> }[] } {
  const calls: { source: string; options: Record<string, unknown> }[] = [];
  return {
    calls,
    launchCamera: async options => { calls.push({ source: 'camera', options: options as unknown as Record<string, unknown> }); return response; },
    launchImageLibrary: async options => { calls.push({ source: 'library', options: options as unknown as Record<string, unknown> }); return response; },
  };
}

it('decodes base64 exactly like Node for every length and rejects invalid input', () => {
  for (let length = 0; length < 70; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length) % 256);
    const encoded = Buffer.from(bytes).toString('base64');
    expect(base64ToBytes(encoded)).toEqual(bytes);
    expect(base64ToBytes(encoded.replace(/[=]+$/, ''))).toEqual(bytes);
  }
  expect(base64ToBytes('aGVs\nbG8=')).toEqual(Uint8Array.from([104, 101, 108, 108, 111]));
  expect(base64ToBytes('a')).toBeNull();
  expect(base64ToBytes('ab$d')).toBeNull();
  expect(base64ToBytes('aé==')).toBeNull();
});

it('asks the gallery for photos only, resized, with bytes and at most the remaining slots', async () => {
  const jpeg = Buffer.from(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])).toString('base64');
  const fake = launchers({ assets: [
    { uri: 'file:///a.jpg', base64: jpeg, width: 2400, height: 1600 },
    { uri: 'file:///b.jpg', base64: jpeg, width: 1600, height: 1200 },
    { uri: 'file:///c.jpg', base64: jpeg, width: 1600, height: 1200 },
  ] });
  const result = await pickPhotos('library', 2, fake);
  expect(fake.calls).toEqual([{ source: 'library', options: expect.objectContaining({
    mediaType: 'photo', includeBase64: true, maxWidth: 2400, maxHeight: 2400, selectionLimit: 2,
    restrictMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], assetRepresentationMode: 'compatible',
  }) }]);
  expect(result.status === 'picked' && result.photos.map(photo => [photo.uri, photo.width, Array.from(photo.bytes)])).toEqual([
    ['file:///a.jpg', 2400, [0xff, 0xd8, 0xff, 0xe0]],
    ['file:///b.jpg', 1600, [0xff, 0xd8, 0xff, 0xe0]],
  ]);
  expect(await pickPhotos('library', 0, fake)).toEqual({ status: 'cancelled' });
  expect(fake.calls).toHaveLength(1);
});

it('uses the camera without saving to the roll and reports cancellations and failures', async () => {
  const camera = launchers({ didCancel: true });
  expect(await pickPhotos('camera', 3, camera)).toEqual({ status: 'cancelled' });
  expect(camera.calls[0]).toEqual({ source: 'camera', options: expect.objectContaining({ saveToPhotos: false, includeBase64: true }) });
  expect(await pickPhotos('camera', 1, launchers({ errorCode: 'camera_unavailable' }))).toEqual({ status: 'failed', error: 'camera_unavailable' });
  expect(await pickPhotos('library', 1, launchers({ errorCode: 'permission' }))).toEqual({ status: 'failed', error: 'permission' });
  expect(await pickPhotos('library', 1, launchers({ errorCode: 'others' }))).toEqual({ status: 'failed', error: 'picker_failed' });
  expect(await pickPhotos('library', 1, launchers({ assets: [{ uri: 'file:///x.heic' }] }))).toEqual({ status: 'failed', error: 'picker_failed' });
  const throwing: Launchers = { launchCamera: async () => { throw new Error('boom'); }, launchImageLibrary: async () => { throw new Error('boom'); } };
  expect(await pickPhotos('camera', 1, throwing)).toEqual({ status: 'failed', error: 'picker_failed' });
});

it('builds the same function URL as the deployed function', () => {
  for (const base of ['https://ykfv5j3m.us-east.insforge.app', 'https://abc123.eu-central.insforge.app/', 'http://ykfv5j3m.us-east.insforge.app', 'https://evil.example/x.insforge.app']) {
    expect(offerMediaFunctionUrl(base)).toBe(functionsBaseUrl(base));
  }
  expect(offerMediaFunctionUrl('https://ykfv5j3m.us-east.insforge.app')).toBe('https://ykfv5j3m.function2.insforge.app/offer-media');
});

it('decodes a 5 MB photo exactly and fast enough to keep the screen responsive', () => {
  const bytes = Uint8Array.from({ length: 5 * 1024 * 1024 }, (_, index) => (index * 31 + 7) % 256);
  const encoded = Buffer.from(bytes).toString('base64');
  const started = Date.now();
  const decoded = base64ToBytes(encoded);
  const elapsed = Date.now() - started;
  expect(decoded?.length).toBe(bytes.length);
  expect(decoded?.[4_000_000]).toBe(bytes[4_000_000]);
  expect(elapsed).toBeLessThan(2000);
});
