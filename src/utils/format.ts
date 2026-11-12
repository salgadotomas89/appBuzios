// Precios en reales (Búzios), con punto de miles: R$ 1.250
export function brl(value: number): string {
  const int = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${int}`;
}

export function brlFromCents(value: number): string {
  const absolute = Math.abs(Math.trunc(value));
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = String(absolute % 100).padStart(2, '0');
  return `${value < 0 ? '-' : ''}R$ ${whole},${cents}`;
}

export function discountPercent(price: number, original?: number): number {
  if (!original || original <= price) {
    return 0;
  }
  return Math.round((1 - price / original) * 100);
}
