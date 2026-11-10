// Precios en reales (Búzios), con punto de miles: R$ 1.250
export function brl(value: number): string {
  const int = String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${int}`;
}

export function discountPercent(price: number, original?: number): number {
  if (!original || original <= price) {
    return 0;
  }
  return Math.round((1 - price / original) * 100);
}
