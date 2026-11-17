import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { ProviderProfileForm } from '../src/components/ProviderProfileForm';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));
async function press(root: ReactTestInstance, label: string) {
  const node = root.findAllByType(Text).find(item => flatten(item.props.children) === label);
  if (!node) throw new Error(`Text not found: ${label}`);
  let parent = node.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  await act(async () => parent?.props.onPress());
}
const input = (root: ReactTestInstance, label: string) =>
  root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];

it('loads the current profile, toggles languages and saves trimmed values', async () => {
  const load = jest.fn(async () => ({ name: 'Mar Azul', public_description: 'Pousada', neighborhood: 'Geribá', languages: ['pt' as const] }));
  const save = jest.fn(async () => null);
  function Harness() {
    const [message, setMessage] = useState('');
    const run = (action: () => Promise<string | void>) => {
      action().then(result => setMessage(result ?? ''));
    };
    return (
      <>
        <ProviderProfileForm language="es" load={load} save={save} run={run} busy={false} />
        <Text>{`message:${message}`}</Text>
      </>
    );
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness />);
  });
  const root = renderer.root;
  expect(texts(root)).toContain('Perfil público · Mar Azul');
  expect(input(root, 'Barrio en Búzios').props.value).toBe('Geribá');
  await press(root, 'Portugués');
  await press(root, 'Inglés');
  await act(async () => input(root, 'Sobre tu negocio (máx. 500)').props.onChangeText('  Café da manhã incluído  '));
  await press(root, 'Guardar perfil');
  expect(save).toHaveBeenCalledWith({ description: 'Café da manhã incluído', neighborhood: 'Geribá', languages: ['en'] });
  expect(texts(root)).toContain('message:Perfil guardado.');
});
