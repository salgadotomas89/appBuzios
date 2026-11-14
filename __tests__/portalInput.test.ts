import { inputErrorText } from '../src/i18n/portalCopy';
import {
  addDays,
  centsToBrlInput,
  localIsoDate,
  parseBrlToCents,
  parseCount,
  parseIsoDate,
} from '../src/utils/portalInput';

describe('parseBrlToCents', () => {
  it.each([
    ['320', 32000],
    ['320,5', 32050],
    ['320,50', 32050],
    ['1.234,56', 123456],
    ['R$ 1.234,56', 123456],
    ['1.234', 123400],
    ['320.50', 32050],
    [' 0,01 ', 1],
  ])('parses %p as %p cents', (input, cents) => {
    expect(parseBrlToCents(input)).toEqual({ ok: true, value: cents });
  });

  it.each(['', 'abc', '12,345', '1,2,3', '-5', '0', '0,00', '1.23.4', '12.3456'])(
    'rejects %p',
    input => {
      expect(parseBrlToCents(input).ok).toBe(false);
    },
  );

  it('rejects amounts above the integer column range', () => {
    expect(parseBrlToCents('21.474.836,48').ok).toBe(false);
    expect(parseBrlToCents('21.474.836,47')).toEqual({ ok: true, value: 2147483647 });
  });

  it('round-trips with centsToBrlInput', () => {
    expect(centsToBrlInput(32050)).toBe('320,50');
    expect(parseBrlToCents(centsToBrlInput(123401))).toEqual({ ok: true, value: 123401 });
  });
});

describe('parseIsoDate', () => {
  const today = '2026-11-14';

  it('accepts today and future calendar dates', () => {
    expect(parseIsoDate('2026-11-14', today)).toEqual({ ok: true, value: '2026-11-14' });
    expect(parseIsoDate(' 2028-02-29 ', today)).toEqual({ ok: true, value: '2028-02-29' });
  });

  it.each([
    ['2026-11-13', 'date_past'],
    ['2027-02-29', 'date_invalid'],
    ['2026-13-01', 'date_invalid'],
    ['14/11/2026', 'date_format'],
    ['2026-1-5', 'date_format'],
    ['', 'date_format'],
  ])('rejects %p with %p', (input, code) => {
    expect(parseIsoDate(input, today)).toEqual({ ok: false, error: { code } });
  });
});

describe('parseCount', () => {
  it('accepts integers within range', () => {
    expect(parseCount('3', { max: 30 })).toEqual({ ok: true, value: 3 });
    expect(parseCount('0', { min: 0 })).toEqual({ ok: true, value: 0 });
  });

  it.each([
    ['', 'count_integer'],
    ['abc', 'count_integer'],
    ['1.5', 'count_integer'],
    ['-1', 'count_integer'],
    ['0', 'count_range'],
    ['31', 'count_range'],
  ])('rejects %p for nights with %p', (input, code) => {
    expect(parseCount(input, { max: 30 })).toEqual({
      ok: false,
      error: code === 'count_range' ? { code, min: 1, max: 30 } : { code },
    });
  });

  it('renders localized messages with the field label', () => {
    const result = parseCount('31', { max: 30 });
    if (result.ok) throw new Error('expected failure');
    expect(inputErrorText('es', 'Noches', result.error)).toBe('Noches: debe estar entre 1 y 30.');
    expect(inputErrorText('pt', 'Noites', result.error)).toBe('Noites: deve estar entre 1 e 30.');
  });
});

it('adds days across month and leap-year boundaries', () => {
  expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  expect(addDays('2028-02-28', 2)).toBe('2028-03-01');
});

it('formats the local calendar date', () => {
  expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
});
