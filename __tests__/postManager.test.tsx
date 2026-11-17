import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { PostManager } from '../src/components/PostManager';
import { portalCopy } from '../src/i18n/portalCopy';
import type { OwnPost } from '../src/lib/platformService';
import { ReservationError } from '../src/lib/reservationService';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

const OFFER = 'offer-1';
const words = portalCopy.es.posts;

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));
const press = async (root: ReactTestInstance, label: string) => {
  const node = root.findAllByType(Text).find(item => flatten(item.props.children) === label);
  if (!node) throw new Error(`Text not found: ${label}\n${texts(root).join('\n')}`);
  let parent = node.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  await act(async () => parent?.props.onPress());
};
const type = async (root: ReactTestInstance, label: string, value: string) => {
  const input = root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];
  await act(async () => input.props.onChangeText(value));
};

function post(overrides: Partial<OwnPost>): OwnPost {
  return {
    id: 'p1', offer_id: OFFER, kind: 'post', body: 'Trilha', link_url: null, link_platform: null, status: 'pending',
    moderation_note: '', visible_until: null, created_at: '', ...overrides,
  };
}

async function render(list: OwnPost[], save = jest.fn(async () => post({})), remove = jest.fn(async () => undefined)) {
  const load = jest.fn(async () => list);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <PostManager
        offerId={OFFER}
        language="es"
        load={load}
        save={save}
        remove={remove}
        // Una función nueva en cada render, como en el portal: no debe provocar recargas en bucle.
        describeError={error => (error instanceof ReservationError && error.code ? portalCopy.es.errors[error.code] : 'error')}
      />,
    );
  });
  return { root: renderer.root, load, save, remove };
}

it('lists only this offer posts with status and the rejection reason, loading once', async () => {
  const { root, load } = await render([
    post({ id: 'a', status: 'rejected', moderation_note: 'Foto de outro lugar' }),
    post({ id: 'b', offer_id: 'other', body: 'Outra oferta' }),
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(texts(root)).toContain(`${words.kindPost} · ${words.status.rejected}`);
  expect(texts(root)).toContain('Foto de outro lugar');
  expect(texts(root)).not.toContain('Outra oferta');
});

it('sends a story with a cleaned permalink and refuses unsupported links locally', async () => {
  const { root, save } = await render([]);
  await press(root, words.kindStory);
  await type(root, words.body, '  Vagas hoje  ');
  await type(root, words.link, 'https://example.com/p/AbCdEf123/');
  await press(root, words.save);
  expect(save).not.toHaveBeenCalled();
  expect(texts(root)).toContain(words.badLink);

  await type(root, words.link, 'https://www.instagram.com/reel/AbCdEf123/?igsh=x');
  await press(root, words.save);
  expect(save).toHaveBeenCalledWith({
    postId: null, offerId: OFFER, kind: 'story', body: 'Vagas hoje', linkUrl: 'https://www.instagram.com/reel/AbCdEf123/',
  });
  expect(texts(root)).toContain(words.saved);
});

it('shows the daily limit from the server and deletes a post', async () => {
  const save = jest.fn(async () => { throw new ReservationError('x', 'post_rate_limited'); });
  const { root, remove } = await render([post({ id: 'a', body: 'Trilha' })], save);
  await type(root, words.body, 'Mais uma');
  await press(root, words.save);
  expect(texts(root)).toContain(portalCopy.es.errors.post_rate_limited);
  await press(root, words.remove);
  expect(remove).toHaveBeenCalledWith('a');
  expect(texts(root)).toContain(words.removed);
});
