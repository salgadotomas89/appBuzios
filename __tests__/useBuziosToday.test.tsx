import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { useBuziosToday } from '../src/hooks/useBuziosToday';

function Probe() {
  return <Text>{useBuziosToday()}</Text>;
}

afterEach(() => jest.useRealTimers());

it('moves to the next Búzios day while the app stays open', () => {
  jest.useFakeTimers({ now: new Date('2026-11-15T02:59:30Z') }); // 23:59:30 en Búzios
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<Probe />);
  });
  expect(renderer.root.findByType(Text).props.children).toBe('2026-11-14');
  ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(renderer.root.findByType(Text).props.children).toBe('2026-11-15');
  ReactTestRenderer.act(() => renderer.unmount());
});
