import type { IconName } from '../components/Icon';
import type { PortalCategory } from '../i18n/portalCopy';

// Datos de ejemplo para el Home. Reemplazar por datos de InsForge.

export type CategoryStat = {
  id: OfferCategory;
  label: Localized;
  count: number;
  highlight?: boolean;
};

export type OfferCategory = PortalCategory;
export type Language = 'es' | 'pt' | 'en';
// Texto en cada idioma de la interfaz; TypeScript exige las tres versiones.
export type Localized<T = string> = Record<Language, T>;

export type Offer = {
  id: string;
  // 'shared' marca ofertas reales de InsForge: se reservan en el portal, no en el viaje demo.
  source?: 'demo' | 'shared';
  category: OfferCategory;
  icon: IconName;
  tone: 'accent' | 'soft';
  title: Localized;
  location: Localized;
  price?: number;
  priceUnit?: Localized;
  originalPrice?: number;
  priceMode: 'night' | 'person' | 'ticket' | 'group';
  availability: 'available' | 'limited' | 'unavailable' | 'incomplete';
  providerCommissionRate?: number;
  description: Localized;
  includes: Localized<string[]>;
  cancellation: Localized;
  meetingPoint?: Localized;
  schedule?: Localized;
  startTime?: string;
  duration?: Localized;
  route?: Localized;
  ticketType?: Localized;
  missingFields?: Localized<string[]>;
  // Fotos autorizadas del proveedor; el texto alternativo lo escribe él en un solo idioma.
  photos?: Array<{ url: string; alt: string; width: number; height: number }>;
  // Solo ofertas compartidas: cupo libre por fecha publicada y límites por reserva.
  freeUnitsByDate?: Record<string, number>;
  quantityLimits?: { min: number; max: number | null };
  // Solo ofertas compartidas: precio base del proveedor y promociones activas (migración 202611160006).
  // price/originalPrice reflejan la promoción vigente en la fecha de referencia (ver withPromotionOn).
  listPrice?: number;
  // Perfil comercial público del proveedor (202611170005), solo ofertas compartidas.
  provider?: { name: string; description: string; neighborhood: string; languages: Array<'pt' | 'es' | 'en'> };
  promotions?: OfferPromotion[];
};

export type OfferPromotion = { percentOffBps: number; startsOn: string; endsOn: string; label: string };

export const homeMock = {
  locationLabel: { es: 'Búzios, Brasil · hoy', pt: 'Búzios, Brasil · hoje', en: 'Búzios, Brazil · today' },
  activeOffers: 6,
  maxDiscount: 50,
  categories: [
    { id: 'pousadas', label: { es: 'Pousadas', pt: 'Pousadas', en: 'Guesthouses' }, count: 2 },
    { id: 'barcos', label: { es: 'Barcos', pt: 'Barcos', en: 'Boats' }, count: 1 },
    { id: 'noche', label: { es: 'Noche', pt: 'Noite', en: 'Nightlife' }, count: 1 },
    { id: 'buggy', label: { es: 'Buggy', pt: 'Buggy', en: 'Buggy' }, count: 2 },
    // Sin ofertas de ejemplo: no se inventan experiencias VIP para la demo.
    { id: 'experiencias', label: { es: 'Experiencias VIP', pt: 'Experiências VIP', en: 'VIP experiences' }, count: 0 },
    // Categorías de 202611160006: se llenan con ofertas reales de proveedores, sin ejemplos inventados.
    { id: 'restaurantes', label: { es: 'Restaurantes', pt: 'Restaurantes', en: 'Restaurants' }, count: 0 },
    { id: 'actividades', label: { es: 'Actividades', pt: 'Atividades', en: 'Activities' }, count: 0 },
  ] as CategoryStat[],
  offers: [
    {
      id: 'barco-escuna',
      category: 'barcos',
      icon: 'boat',
      tone: 'accent',
      title: {
        es: 'Escuna por 12 playas',
        pt: 'Escuna por 12 praias',
        en: 'Schooner tour of 12 beaches',
      },
      location: { es: 'Porto da Barra', pt: 'Porto da Barra', en: 'Porto da Barra' },
      price: 89,
      priceUnit: { es: 'por persona', pt: 'por pessoa', en: 'per person' },
      originalPrice: 140,
      priceMode: 'person',
      availability: 'limited',
      providerCommissionRate: 0.18,
      description: {
        es: 'Un día navegando por calas e islas de la península, con tiempo para nadar y disfrutar a bordo.',
        pt: 'Um dia navegando por enseadas e ilhas da península, com tempo para nadar e curtir a bordo.',
        en: "A day sailing around the peninsula's coves and islands, with time to swim and relax on board.",
      },
      includes: {
        es: ['Paseo en escuna', 'Paradas para nadar', 'Guía local'],
        pt: ['Passeio de escuna', 'Paradas para nadar', 'Guia local'],
        en: ['Schooner tour', 'Swimming stops', 'Local guide'],
      },
      cancellation: {
        es: 'Cancelación gratuita hasta 24 h antes. Sujeto a condiciones del mar.',
        pt: 'Cancelamento grátis até 24 h antes. Sujeito às condições do mar.',
        en: 'Free cancellation up to 24 h before. Subject to sea conditions.',
      },
      meetingPoint: {
        es: 'Muelle de Porto da Barra',
        pt: 'Píer de Porto da Barra',
        en: 'Porto da Barra pier',
      },
      schedule: { es: 'Salida 11:00', pt: 'Saída às 11h', en: 'Departure 11:00' },
      startTime: '11:00',
      duration: { es: '6 horas', pt: '6 horas', en: '6 hours' },
      route: {
        es: '12 playas y paradas en Ilha Feia y João Fernandes',
        pt: '12 praias e paradas na Ilha Feia e em João Fernandes',
        en: '12 beaches with stops at Ilha Feia and João Fernandes',
      },
    },
    {
      id: 'buggy-tour',
      category: 'buggy',
      icon: 'buggy',
      tone: 'accent',
      title: {
        es: 'Ruta en buggy por Búzios',
        pt: 'Passeio de buggy em Búzios',
        en: 'Buggy tour of Búzios',
      },
      location: {
        es: 'Salida desde tu pousada',
        pt: 'Saída da sua pousada',
        en: 'Pickup at your guesthouse',
      },
      price: 150,
      priceUnit: { es: 'por paseo', pt: 'por passeio', en: 'per tour' },
      originalPrice: 200,
      priceMode: 'group',
      availability: 'available',
      providerCommissionRate: undefined,
      description: {
        es: 'Recorrido panorámico para conocer miradores y playas de Búzios en buggy.',
        pt: 'Roteiro panorâmico para conhecer mirantes e praias de Búzios de buggy.',
        en: 'Scenic ride to see the viewpoints and beaches of Búzios by buggy.',
      },
      includes: {
        es: ['Conductor acreditado', 'Paradas para fotos'],
        pt: ['Motorista credenciado', 'Paradas para fotos'],
        en: ['Licensed driver', 'Photo stops'],
      },
      cancellation: {
        es: 'Cancelación gratuita hasta 24 h antes.',
        pt: 'Cancelamento grátis até 24 h antes.',
        en: 'Free cancellation up to 24 h before.',
      },
      meetingPoint: {
        es: 'Retiro en pousada por confirmar',
        pt: 'Busca na pousada a confirmar',
        en: 'Guesthouse pickup to be confirmed',
      },
      schedule: { es: 'Horario por coordinar', pt: 'Horário a combinar', en: 'Schedule to be arranged' },
      startTime: '09:00',
      duration: { es: '4 horas', pt: '4 horas', en: '4 hours' },
      route: {
        es: 'Miradores y playas de la península; operador por confirmar',
        pt: 'Mirantes e praias da península; operador a confirmar',
        en: 'Peninsula viewpoints and beaches; operator to be confirmed',
      },
    },
    {
      id: 'disco-2x1',
      category: 'noche',
      icon: 'music',
      tone: 'soft',
      title: { es: 'Noche 2x1 en Privilege', pt: 'Noite 2 por 1 no Privilege', en: '2-for-1 night at Privilege' },
      location: { es: 'Rua das Pedras', pt: 'Rua das Pedras', en: 'Rua das Pedras' },
      price: 60,
      priceUnit: { es: 'por entrada', pt: 'por ingresso', en: 'per ticket' },
      originalPrice: 120,
      priceMode: 'ticket',
      availability: 'available',
      providerCommissionRate: 0.15,
      description: {
        es: 'Entrada promocional para una noche de música y baile en Rua das Pedras.',
        pt: 'Ingresso promocional para uma noite de música e dança na Rua das Pedras.',
        en: 'Promotional ticket for a night of music and dancing on Rua das Pedras.',
      },
      includes: {
        es: ['Entrada general', 'Promoción 2x1 indicada por el aliado'],
        pt: ['Ingresso pista', 'Promoção 2 por 1 informada pelo parceiro'],
        en: ['General admission', '2-for-1 promotion stated by the partner'],
      },
      cancellation: {
        es: 'No reembolsable después de las 18:00 del día del evento.',
        pt: 'Não reembolsável após as 18h do dia do evento.',
        en: 'Non-refundable after 18:00 on the day of the event.',
      },
      meetingPoint: { es: 'Privilege, Manguinhos', pt: 'Privilege, Manguinhos', en: 'Privilege, Manguinhos' },
      schedule: { es: 'Evento 23:00', pt: 'Evento às 23h', en: 'Event 23:00' },
      startTime: '23:00',
      ticketType: { es: 'Entrada general', pt: 'Ingresso pista', en: 'General admission' },
    },
    {
      id: 'pousada-geriba',
      category: 'pousadas',
      icon: 'bed',
      tone: 'soft',
      title: { es: 'Pousada Maravista', pt: 'Pousada Maravista', en: 'Pousada Maravista' },
      location: { es: 'Geribá · frente al mar', pt: 'Geribá · pé na areia', en: 'Geribá · beachfront' },
      price: 320,
      priceUnit: { es: 'por noche', pt: 'por noite', en: 'per night' },
      originalPrice: 430,
      priceMode: 'night',
      availability: 'limited',
      providerCommissionRate: 0.1,
      description: {
        es: 'Alojamiento de ejemplo cerca de Porto da Barra para organizar tu estancia antes de viajar.',
        pt: 'Hospedagem de exemplo perto de Porto da Barra para planejar sua estadia antes da viagem.',
        en: 'Sample accommodation near Porto da Barra to plan your stay before you travel.',
      },
      includes: {
        es: ['Habitación doble de ejemplo', 'Desayuno sujeto a confirmación'],
        pt: ['Quarto duplo de exemplo', 'Café da manhã a confirmar'],
        en: ['Sample double room', 'Breakfast subject to confirmation'],
      },
      cancellation: {
        es: 'Condiciones ilustrativas: cancelación gratuita hasta 7 días antes.',
        pt: 'Condições ilustrativas: cancelamento grátis até 7 dias antes.',
        en: 'Illustrative terms: free cancellation up to 7 days before.',
      },
      meetingPoint: {
        es: 'Porto da Barra · dirección por confirmar',
        pt: 'Porto da Barra · endereço a confirmar',
        en: 'Porto da Barra · address to be confirmed',
      },
      schedule: { es: 'Check-in 14:00 · salida 12:00', pt: 'Check-in 14h · saída 12h', en: 'Check-in 14:00 · check-out 12:00' },
      startTime: '14:00',
    },
    {
      id: 'pousada-incompleta',
      category: 'pousadas',
      icon: 'bed',
      tone: 'soft',
      title: { es: 'Estadía por confirmar', pt: 'Hospedagem a confirmar', en: 'Stay to be confirmed' },
      location: { es: 'Porto da Barra', pt: 'Porto da Barra', en: 'Porto da Barra' },
      priceMode: 'night',
      availability: 'incomplete',
      description: {
        es: 'Ficha de ejemplo para mostrar un alojamiento que todavía no está listo para reservar.',
        pt: 'Anúncio de exemplo para mostrar uma hospedagem que ainda não está pronta para reservar.',
        en: 'Sample listing for an accommodation that is not ready to book yet.',
      },
      includes: { es: [], pt: [], en: [] },
      cancellation: {
        es: 'Las condiciones estarán disponibles cuando el alojamiento confirme sus datos.',
        pt: 'As condições estarão disponíveis quando a hospedagem confirmar os dados.',
        en: 'Terms will be available once the accommodation confirms its details.',
      },
      missingFields: {
        es: ['Tarifa', 'Fotos', 'Política de cancelación'],
        pt: ['Diária', 'Fotos', 'Política de cancelamento'],
        en: ['Rate', 'Photos', 'Cancellation policy'],
      },
    },
    {
      id: 'buggy-sunset',
      category: 'buggy',
      icon: 'buggy',
      tone: 'soft',
      title: { es: 'Buggy al atardecer', pt: 'Buggy ao pôr do sol', en: 'Sunset buggy ride' },
      location: { es: 'Punto de encuentro por confirmar', pt: 'Ponto de encontro a confirmar', en: 'Meeting point to be confirmed' },
      price: 180,
      priceUnit: { es: 'por grupo', pt: 'por grupo', en: 'per group' },
      priceMode: 'group',
      availability: 'unavailable',
      description: {
        es: 'Experiencia de ejemplo temporalmente sin disponibilidad.',
        pt: 'Experiência de exemplo temporariamente sem disponibilidade.',
        en: 'Sample experience, temporarily unavailable.',
      },
      includes: { es: ['Recorrido panorámico'], pt: ['Roteiro panorâmico'], en: ['Scenic ride'] },
      cancellation: {
        es: 'Política por confirmar con el operador.',
        pt: 'Política a confirmar com o operador.',
        en: 'Policy to be confirmed with the operator.',
      },
      missingFields: {
        es: ['Operador', 'Horario', 'Punto de encuentro'],
        pt: ['Operador', 'Horário', 'Ponto de encontro'],
        en: ['Operator', 'Schedule', 'Meeting point'],
      },
    },
  ] as Offer[],
};
