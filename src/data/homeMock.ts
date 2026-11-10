import type { IconName } from '../components/Icon';

// Datos de ejemplo para el Home. Reemplazar por datos de InsForge.

export type CategoryStat = {
  label: string;
  count: number;
  highlight?: boolean; // barra oscura: la categoría "del día"
};

export type Offer = {
  id: string;
  icon: IconName;
  tone: 'accent' | 'soft';
  title: string;
  subtitle: string;
  price: number;
  originalPrice?: number;
};

export const homeMock = {
  locationLabel: 'Búzios · hoy, lun 9 nov',
  activeOffers: 48,
  maxDiscount: 40,
  places: 'Rua das Pedras + Geribá',
  categoriesNote: 'Hoy: fiestas a mitad de precio',
  categories: [
    { label: 'Pousadas', count: 14 },
    { label: 'Barcos', count: 9 },
    { label: 'Comida', count: 12 },
    { label: 'Buggy', count: 5 },
    { label: 'Fiestas', count: 8, highlight: true },
  ] as CategoryStat[],
  offers: [
    {
      id: 'barco-escuna',
      icon: 'boat',
      tone: 'accent',
      title: 'Fiesta en barco por 12 playas',
      subtitle: 'Sale 11:00 · Porto da Barra · con DJ',
      price: 89,
      originalPrice: 140,
    },
    {
      id: 'buggy-tour',
      icon: 'buggy',
      tone: 'accent',
      title: 'Paseo en buggy, día completo',
      subtitle: 'Quedan 3 cupos · retiro en tu pousada',
      price: 150,
      originalPrice: 200,
    },
    {
      id: 'disco-2x1',
      icon: 'music',
      tone: 'soft',
      title: 'Entrada 2x1 en discoteca',
      subtitle: 'Hoy 23:00 · Rua das Pedras',
      price: 60,
      originalPrice: 120,
    },
    {
      id: 'pousada-geriba',
      icon: 'bed',
      tone: 'soft',
      title: 'Pousada frente al mar',
      subtitle: 'Geribá · desayuno incluido · por noche',
      price: 320,
      originalPrice: 430,
    },
    {
      id: 'cena-atardecer',
      icon: 'food',
      tone: 'soft',
      title: 'Cena con vista al atardecer',
      subtitle: 'Orla Bardot · menú para 2',
      price: 180,
    },
  ] as Offer[],
};
