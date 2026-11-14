// Validación de los formularios del portal compartido. PostgreSQL vuelve a
// validar todo; esto evita enviar NaN o fechas inválidas y explica el error.
// Los errores son códigos para que la pantalla los muestre en el idioma activo.

export type InputErrorCode =
  | 'price_required'
  | 'price_format'
  | 'price_positive'
  | 'price_max'
  | 'date_format'
  | 'date_invalid'
  | 'date_past'
  | 'count_integer'
  | 'count_range'
  | 'percent_format'
  | 'percent_range';

export type InputError = { code: InputErrorCode; min?: number; max?: number };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: InputError };

// Límite de la columna integer de PostgreSQL usada para centavos.
const MAX_CENTS = 2147483647;

function fail<T>(code: InputErrorCode, extra: Omit<InputError, 'code'> = {}): ParseResult<T> {
  return { ok: false, error: { code, ...extra } };
}

// Acepta "320", "320,50", "1.234,56", "R$ 1.234,5" y también "320.50".
export function parseBrlToCents(input: string): ParseResult<number> {
  const raw = input.replace(/R\$/i, '').replace(/\s/g, '');
  if (!raw) return fail('price_required');

  let normalized: string;
  if (raw.includes(',')) {
    // Formato brasileño: punto de miles, coma decimal.
    if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(raw)) return fail('price_format');
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(raw)) {
    normalized = raw;
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(raw)) {
    normalized = raw.replace(/\./g, '');
  } else {
    return fail('price_format');
  }

  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return fail('price_max');
  if (cents <= 0) return fail('price_positive');
  return { ok: true, value: cents };
}

export function centsToBrlInput(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}

export function parseIsoDate(input: string, today: string): ParseResult<string> {
  const value = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return fail('date_format');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return fail('date_invalid');
  }
  if (value < today) return fail('date_past');
  return { ok: true, value };
}

export function parseCount(
  input: string,
  { min = 1, max = 365 }: { min?: number; max?: number } = {},
): ParseResult<number> {
  const value = input.trim();
  if (!/^\d+$/.test(value)) return fail('count_integer');
  const count = Number(value);
  if (count < min || count > max) return fail('count_range', { min, max });
  return { ok: true, value: count };
}

// "18", "18,5" o "18.25" → puntos básicos enteros (1800, 1850, 1825), sin pasar por coma flotante.
// Vacío devuelve null: la pantalla lo usa para "sin excepción".
export function parsePercentToBps(input: string): ParseResult<number | null> {
  const value = input.trim().replace('%', '').trim();
  if (!value) return { ok: true, value: null };
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return fail('percent_format');
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (bps > 10_000) return fail('percent_range');
  return { ok: true, value: bps };
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Fecha de hoy en Búzios, la misma referencia que usa connectical_today() en PostgreSQL.
// Brasil no aplica horario de verano desde 2019, así que São Paulo es UTC−3 fijo.
export function buziosIsoDate(now = new Date()): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function localIsoDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
