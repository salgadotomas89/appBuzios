import type { IconName } from '../components/Icon';

// Datos de ejemplo para el Home. Reemplazar por datos de InsForge.

export type CategoryStat = {
  id: OfferCategory;
  label: { es: string; pt: string };
  count: number;
  highlight?: boolean;
};

export type OfferCategory = 'pousadas' | 'barcos' | 'noche' | 'buggy';
export type Language = 'es' | 'pt';

export type Offer = {
  id: string;
  category: OfferCategory;
  icon: IconName;
  tone: 'accent' | 'soft';
  title: { es: string; pt: string };
  location: { es: string; pt: string };
  price?: number;
  priceUnit?: { es: string; pt: string };
  originalPrice?: number;
  priceMode: 'night' | 'person' | 'ticket' | 'group';
  availability: 'available' | 'limited' | 'unavailable' | 'incomplete';
  providerCommissionRate?: number;
  description: { es: string; pt: string };
  includes: { es: string[]; pt: string[] };
  cancellation: { es: string; pt: string };
  meetingPoint?: { es: string; pt: string };
  schedule?: { es: string; pt: string };
  startTime?: string;
  duration?: { es: string; pt: string };
  route?: { es: string; pt: string };
  ticketType?: { es: string; pt: string };
  missingFields?: { es: string[]; pt: string[] };
};

export const homeMock = {
  locationLabel: { es: 'Búzios, Brasil · hoy', pt: 'Búzios, Brasil · hoje' },
  activeOffers: 6,
  maxDiscount: 50,
  categories: [
    { id: 'pousadas', label: { es: 'Pousadas', pt: 'Pousadas' }, count: 2 },
    { id: 'barcos', label: { es: 'Barcos', pt: 'Barcos' }, count: 1 },
    { id: 'noche', label: { es: 'Noche', pt: 'Noite' }, count: 1 },
    { id: 'buggy', label: { es: 'Buggy', pt: 'Buggy' }, count: 2 },
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
      },
      location: { es: 'Porto da Barra', pt: 'Porto da Barra' },
      price: 89,
      priceUnit: { es: 'por persona', pt: 'por pessoa' },
      originalPrice: 140,
      priceMode: 'person',
      availability: 'limited',
      providerCommissionRate: 0.18,
      description: {
        es: 'Un día navegando por calas e islas de la península, con tiempo para nadar y disfrutar a bordo.',
        pt: 'Um dia navegando por enseadas e ilhas da península, com tempo para nadar e curtir a bordo.',
      },
      includes: {
        es: ['Paseo en escuna', 'Paradas para nadar', 'Guía local'],
        pt: ['Passeio de escuna', 'Paradas para nadar', 'Guia local'],
      },
      cancellation: {
        es: 'Cancelación gratuita hasta 24 h antes. Sujeto a condiciones del mar.',
        pt: 'Cancelamento grátis até 24 h antes. Sujeito às condições do mar.',
      },
      meetingPoint: {
        es: 'Muelle de Porto da Barra',
        pt: 'Píer de Porto da Barra',
      },
      schedule: { es: 'Salida 11:00', pt: 'Saída às 11h' },
      startTime: '11:00',
      duration: { es: '6 horas', pt: '6 horas' },
      route: {
        es: '12 playas y paradas en Ilha Feia y João Fernandes',
        pt: '12 praias e paradas na Ilha Feia e em João Fernandes',
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
      },
      location: {
        es: 'Salida desde tu pousada',
        pt: 'Saída da sua pousada',
      },
      price: 150,
      priceUnit: { es: 'por paseo', pt: 'por passeio' },
      originalPrice: 200,
      priceMode: 'group',
      availability: 'available',
      providerCommissionRate: undefined,
      description: {
        es: 'Recorrido panorámico para conocer miradores y playas de Búzios en buggy.',
        pt: 'Roteiro panorâmico para conhecer mirantes e praias de Búzios de buggy.',
      },
      includes: {
        es: ['Conductor acreditado', 'Paradas para fotos'],
        pt: ['Motorista credenciado', 'Paradas para fotos'],
      },
      cancellation: {
        es: 'Cancelación gratuita hasta 24 h antes.',
        pt: 'Cancelamento grátis até 24 h antes.',
      },
      meetingPoint: {
        es: 'Retiro en pousada por confirmar',
        pt: 'Busca na pousada a confirmar',
      },
      schedule: { es: 'Horario por coordinar', pt: 'Horário a combinar' },
      startTime: '09:00',
      duration: { es: '4 horas', pt: '4 horas' },
      route: {
        es: 'Miradores y playas de la península; operador por confirmar',
        pt: 'Mirantes e praias da península; operador a confirmar',
      },
    },
    {
      id: 'disco-2x1',
      category: 'noche',
      icon: 'music',
      tone: 'soft',
      title: { es: 'Noche 2x1 en Privilege', pt: 'Noite 2 por 1 no Privilege' },
      location: { es: 'Rua das Pedras', pt: 'Rua das Pedras' },
      price: 60,
      priceUnit: { es: 'por entrada', pt: 'por ingresso' },
      originalPrice: 120,
      priceMode: 'ticket',
      availability: 'available',
      providerCommissionRate: 0.15,
      description: {
        es: 'Entrada promocional para una noche de música y baile en Rua das Pedras.',
        pt: 'Ingresso promocional para uma noite de música e dança na Rua das Pedras.',
      },
      includes: {
        es: ['Entrada general', 'Promoción 2x1 indicada por el aliado'],
        pt: ['Ingresso pista', 'Promoção 2 por 1 informada pelo parceiro'],
      },
      cancellation: {
        es: 'No reembolsable después de las 18:00 del día del evento.',
        pt: 'Não reembolsável após as 18h do dia do evento.',
      },
      meetingPoint: { es: 'Privilege, Manguinhos', pt: 'Privilege, Manguinhos' },
      schedule: { es: 'Evento 23:00', pt: 'Evento às 23h' },
      startTime: '23:00',
      ticketType: { es: 'Entrada general', pt: 'Ingresso pista' },
    },
    {
      id: 'pousada-geriba',
      category: 'pousadas',
      icon: 'bed',
      tone: 'soft',
      title: { es: 'Pousada Maravista', pt: 'Pousada Maravista' },
      location: { es: 'Geribá · frente al mar', pt: 'Geribá · pé na areia' },
      price: 320,
      priceUnit: { es: 'por noche', pt: 'por noite' },
      originalPrice: 430,
      priceMode: 'night',
      availability: 'limited',
      providerCommissionRate: 0.1,
      description: {
        es: 'Alojamiento de ejemplo cerca de Porto da Barra para organizar tu estancia antes de viajar.',
        pt: 'Hospedagem de exemplo perto de Porto da Barra para planejar sua estadia antes da viagem.',
      },
      includes: {
        es: ['Habitación doble de ejemplo', 'Desayuno sujeto a confirmación'],
        pt: ['Quarto duplo de exemplo', 'Café da manhã a confirmar'],
      },
      cancellation: {
        es: 'Condiciones ilustrativas: cancelación gratuita hasta 7 días antes.',
        pt: 'Condições ilustrativas: cancelamento grátis até 7 dias antes.',
      },
      meetingPoint: {
        es: 'Porto da Barra · dirección por confirmar',
        pt: 'Porto da Barra · endereço a confirmar',
      },
      schedule: { es: 'Check-in 14:00 · salida 12:00', pt: 'Check-in 14h · saída 12h' },
      startTime: '14:00',
    },
    {
      id: 'pousada-incompleta',
      category: 'pousadas',
      icon: 'bed',
      tone: 'soft',
      title: { es: 'Estadía por confirmar', pt: 'Hospedagem a confirmar' },
      location: { es: 'Porto da Barra', pt: 'Porto da Barra' },
      priceMode: 'night',
      availability: 'incomplete',
      description: {
        es: 'Ficha de ejemplo para mostrar un alojamiento que todavía no está listo para reservar.',
        pt: 'Anúncio de exemplo para mostrar uma hospedagem que ainda não está pronta para reservar.',
      },
      includes: { es: [], pt: [] },
      cancellation: {
        es: 'Las condiciones estarán disponibles cuando el alojamiento confirme sus datos.',
        pt: 'As condições estarão disponíveis quando a hospedagem confirmar os dados.',
      },
      missingFields: {
        es: ['Tarifa', 'Fotos', 'Política de cancelación'],
        pt: ['Diária', 'Fotos', 'Política de cancelamento'],
      },
    },
    {
      id: 'buggy-sunset',
      category: 'buggy',
      icon: 'buggy',
      tone: 'soft',
      title: { es: 'Buggy al atardecer', pt: 'Buggy ao pôr do sol' },
      location: { es: 'Punto de encuentro por confirmar', pt: 'Ponto de encontro a confirmar' },
      price: 180,
      priceUnit: { es: 'por grupo', pt: 'por grupo' },
      priceMode: 'group',
      availability: 'unavailable',
      description: {
        es: 'Experiencia de ejemplo temporalmente sin disponibilidad.',
        pt: 'Experiência de exemplo temporariamente sem disponibilidade.',
      },
      includes: { es: ['Recorrido panorámico'], pt: ['Roteiro panorâmico'] },
      cancellation: {
        es: 'Política por confirmar con el operador.',
        pt: 'Política a confirmar com o operador.',
      },
      missingFields: {
        es: ['Operador', 'Horario', 'Punto de encuentro'],
        pt: ['Operador', 'Horário', 'Ponto de encontro'],
      },
    },
  ] as Offer[],
};
