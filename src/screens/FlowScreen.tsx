import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { OfferRow } from '../components/OfferRow';
import { homeMock as data } from '../data/homeMock';
import type { Language, Offer, OfferCategory } from '../data/homeMock';
import { loadDemoState, saveDemoState } from '../lib/demoStorage';
import { ReservationPortal } from './ReservationPortal';
import { SHARED_CATALOG_ENABLED } from '../config/featureFlags';
import { CATEGORY_ICONS, type Catalog } from '../data/catalog';
import { useCatalog, type CatalogSource } from '../data/useCatalog';
import { colors, radius } from '../theme';
import { brlFromCents } from '../utils/format';
import { useBuziosToday } from '../hooks/useBuziosToday';
import { selectGateway } from '../payments/gateways';
import {
  DEFAULT_DEMO_SERVICE_FEE_RATE,
  DEMO_SERVICE_FEE_RATES,
  priceTripItems,
  type TripItem,
} from '../utils/journey';
import type { DemoServiceFeeRate } from '../utils/journey';
import { createPaymentIntent, getInformativeFxQuote, type PaymentStatus } from '../utils/paymentEngine';
import {
  calculateDemoQuote,
  DEFAULT_DEMO_PRICING_POLICY,
} from '../utils/pricingPolicy';
import type { DemoBooking } from '../utils/pricingPolicy';

type Screen = 'home' | 'explore' | 'detail' | 'trip' | 'confirmation' | 'operations';
type Booking = DemoBooking;

const copy = {
  es: {
    title: 'Tu viaje a Búzios',
    location: 'Búzios, Brasil · organiza antes de llegar',
    offerSummary: 'experiencias para descubrir',
    savings: 'Hasta',
    categories: 'Elige tu plan',
    featured: 'Ideas para tu viaje',
    explore: 'Explorar ofertas',
    all: 'Todas',
    search: 'Buscar por nombre o lugar',
    results: 'ofertas de ejemplo',
    sharedResults: 'ofertas',
    noResults: 'No encontramos ofertas con esa búsqueda.',
    noCategory: 'Todavía no hay ofertas en esta categoría.',
    example: 'EJEMPLO · NO ES UNA RESERVA REAL',
    sharedExample: 'OFERTA PUBLICADA · SE RESERVA EN EL PORTAL CON PAGO SIMULADO',
    sharedAvailable: 'Cupo publicado por el proveedor',
    sharedUnavailable: 'Sin cupo publicado',
    sharedUnknown: 'Cupo por confirmar en el portal',
    bookInPortal: 'Reservar en el portal',
    catalogFallback: 'No se pudieron leer las ofertas publicadas; se muestra solo el catálogo de ejemplo.',
    catalogLoading: 'Cargando ofertas publicadas…',
    available: 'Disponible en demo',
    limited: 'Cupos limitados · demo',
    unavailable: 'Sin disponibilidad',
    incomplete: 'Datos incompletos',
    about: 'Sobre esta experiencia',
    includes: 'Qué incluye',
    conditions: 'Cancelación y condiciones',
    meeting: 'Punto de encuentro',
    schedule: 'Horario',
    duration: 'Duración',
    route: 'Recorrido',
    ticket: 'Tipo de entrada',
    date: 'Fecha',
    quantity: 'Cantidad',
    rooms: 'Habitaciones',
    nights: 'Noches',
    addTrip: 'Agregar a Mi viaje',
    pastDate: 'Esta fecha ya pasó en Búzios. Elige otra para confirmar.',
    operations: 'Reservas compartidas · acceso de operaciones',
    previousDay: 'Día anterior',
    nextDay: 'Día siguiente',
    decreaseQuantity: 'Disminuir cantidad',
    increaseQuantity: 'Aumentar cantidad',
    decreaseNights: 'Quitar una noche',
    increaseNights: 'Sumar una noche',
    missing: 'Falta información para reservar',
    trip: 'Mi viaje',
    emptyTrip: 'Tu viaje empieza aquí',
    emptyTripNote: 'Explora ofertas de ejemplo y agrégalas a tu itinerario.',
    subtotal: 'Subtotal',
    serviceFee: 'Cargo de servicio · demo',
    pricingLab: 'Ensayo interno de precios',
    baseCase: 'Base',
    internalOnly: 'Solo interno · no se cobra al viajero',
    grossIncome: 'Ingreso bruto',
    gatewayCost: 'Costo de pasarela · supuesto',
    conversionCost: 'Costo de conversión · supuesto',
    operatingReserve: 'Provisión operativa · supuesto',
    contributionMargin: 'Margen de contribución',
    commissionRates: 'Comisiones proveedor de referencia',
    commissionSummary: 'Pousadas 10% · Barcos 18% · Noche 15% · VIP 18–20%',
    buggyCommission: 'Buggy: pendiente',
    pending: 'Pendiente',
    total: 'Total estimado',
    providerFee: 'Comisión de aliados (referencia interna)',
    notIncluded: 'No se suma al total del viajero',
    providerPending: 'Comisión Buggy pendiente de definir',
    remove: 'Quitar',
    confirm: 'Confirmar reserva demo',
    bookingHistory: 'Reservas de demostración',
    noBookings: 'Todavía no tienes reservas confirmadas.',
    confirmation: '¡Plan confirmado!',
    demoConfirmed: 'Reserva de demostración · sin pago ni disponibilidad real',
    bookingCode: 'Código demo',
    simulatedPayment: 'Pago simulado',
    brlOperation: 'Operación en BRL',
    splitAuthorized: 'split autorizado',
    b2bConciliation: 'conciliación B2B',
    demoFx: 'Conversión USD con tasa fija de demostración, no es una cotización vigente',
    backTrip: 'Volver a Mi viaje',
    backHome: 'Seguir explorando',
    home: 'Inicio',
    tripTab: 'Mi viaje',
    unitPeople: 'personas',
    unitTickets: 'entradas',
    unitGroups: 'grupos',
    unitRooms: 'habitaciones',
    stayDate: 'Fecha de entrada',
    commissionLabel: 'Comisión de proveedor ref.',
    days: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
    months: [
      'ene', 'feb', 'mar', 'abr', 'may', 'jun',
      'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
    ],
  },
  pt: {
    title: 'Sua viagem a Búzios',
    location: 'Búzios, Brasil · planeje antes de chegar',
    offerSummary: 'experiências para descobrir',
    savings: 'Até',
    categories: 'Escolha seu passeio',
    featured: 'Ideias para sua viagem',
    explore: 'Explorar ofertas',
    all: 'Todas',
    search: 'Buscar por nome ou lugar',
    results: 'ofertas de exemplo',
    sharedResults: 'ofertas',
    noResults: 'Não encontramos ofertas com essa busca.',
    noCategory: 'Ainda não há ofertas nesta categoria.',
    example: 'EXEMPLO · NÃO É UMA RESERVA REAL',
    sharedExample: 'OFERTA PUBLICADA · RESERVA NO PORTAL COM PAGAMENTO SIMULADO',
    sharedAvailable: 'Vagas publicadas pelo fornecedor',
    sharedUnavailable: 'Sem vagas publicadas',
    sharedUnknown: 'Vagas a confirmar no portal',
    bookInPortal: 'Reservar no portal',
    catalogFallback: 'Não foi possível ler as ofertas publicadas; mostrando só o catálogo de exemplo.',
    catalogLoading: 'Carregando ofertas publicadas…',
    available: 'Disponível na demo',
    limited: 'Poucas vagas · demo',
    unavailable: 'Sem disponibilidade',
    incomplete: 'Dados incompletos',
    about: 'Sobre esta experiência',
    includes: 'O que está incluído',
    conditions: 'Cancelamento e condições',
    meeting: 'Ponto de encontro',
    schedule: 'Horário',
    duration: 'Duração',
    route: 'Roteiro',
    ticket: 'Tipo de ingresso',
    date: 'Data',
    quantity: 'Quantidade',
    rooms: 'Quartos',
    nights: 'Noites',
    addTrip: 'Adicionar à Minha viagem',
    pastDate: 'Esta data já passou em Búzios. Escolha outra para confirmar.',
    operations: 'Reservas compartilhadas · acesso de operações',
    previousDay: 'Dia anterior',
    nextDay: 'Próximo dia',
    decreaseQuantity: 'Diminuir quantidade',
    increaseQuantity: 'Aumentar quantidade',
    decreaseNights: 'Remover uma noite',
    increaseNights: 'Adicionar uma noite',
    missing: 'Faltam informações para reservar',
    trip: 'Minha viagem',
    emptyTrip: 'Sua viagem começa aqui',
    emptyTripNote: 'Explore ofertas de exemplo e adicione ao seu roteiro.',
    subtotal: 'Subtotal',
    serviceFee: 'Taxa de serviço · demo',
    pricingLab: 'Ensaio interno de preços',
    baseCase: 'Base',
    internalOnly: 'Só interno · não cobrado do viajante',
    grossIncome: 'Receita bruta',
    gatewayCost: 'Custo do gateway · hipótese',
    conversionCost: 'Custo de conversão · hipótese',
    operatingReserve: 'Provisão operacional · hipótese',
    contributionMargin: 'Margem de contribuição',
    commissionRates: 'Comissões de referência do parceiro',
    commissionSummary: 'Pousadas 10% · Barcos 18% · Noite 15% · VIP 18–20%',
    buggyCommission: 'Buggy: pendente',
    pending: 'Pendente',
    total: 'Total estimado',
    providerFee: 'Comissão dos parceiros (referência interna)',
    notIncluded: 'Não somada ao total do viajante',
    providerPending: 'Comissão de Buggy pendente',
    remove: 'Remover',
    confirm: 'Confirmar reserva demo',
    bookingHistory: 'Reservas de demonstração',
    noBookings: 'Você ainda não tem reservas confirmadas.',
    confirmation: 'Roteiro confirmado!',
    demoConfirmed: 'Reserva de demonstração · sem pagamento ou disponibilidade real',
    bookingCode: 'Código demo',
    simulatedPayment: 'Pagamento simulado',
    brlOperation: 'Operação em BRL',
    splitAuthorized: 'split autorizado',
    b2bConciliation: 'conciliação B2B',
    demoFx: 'Conversão em USD com taxa fixa de demonstração, não é uma cotação vigente',
    backTrip: 'Voltar à Minha viagem',
    backHome: 'Continuar explorando',
    home: 'Início',
    tripTab: 'Minha viagem',
    unitPeople: 'pessoas',
    unitTickets: 'ingressos',
    unitGroups: 'grupos',
    unitRooms: 'quartos',
    stayDate: 'Data de entrada',
    commissionLabel: 'Comissão do parceiro ref.',
    days: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    months: [
      'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
      'jul', 'ago', 'set', 'out', 'nov', 'dez',
    ],
  },
} satisfies Record<Language, Record<string, string | string[]>>;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function moveDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}

const PAYMENT_STATE_LABELS: Record<Language, Record<PaymentStatus, string>> = {
  es: {
    pending: 'pendiente', approved: 'aprobado', rejected: 'rechazado', requires_action: 'requiere acción',
    expired: 'vencido', refunded: 'reembolsado', partially_refunded: 'reembolso parcial', cancelled: 'cancelado',
  },
  pt: {
    pending: 'pendente', approved: 'aprovado', rejected: 'recusado', requires_action: 'requer ação',
    expired: 'expirado', refunded: 'reembolsado', partially_refunded: 'reembolso parcial', cancelled: 'cancelado',
  },
};

function formatDate(value: string, language: Language) {
  const date = new Date(`${value}T12:00:00`);
  const words = copy[language];
  const dayNames = words.days as string[];
  const monthNames = words.months as string[];
  return `${dayNames[date.getDay()]}, ${date.getDate()} ${monthNames[date.getMonth()]}`;
}

function categoryName(category: OfferCategory, language: Language) {
  const item = data.categories.find(entry => entry.id === category);
  return item?.label[language] ?? '';
}

function availabilityLabel(offer: Offer, language: Language) {
  const words = copy[language];
  if (offer.source === 'shared') {
    // En ofertas compartidas 'limited' significa que no se pudo leer el inventario.
    if (offer.availability === 'available') return words.sharedAvailable as string;
    if (offer.availability === 'unavailable') return words.sharedUnavailable as string;
    return words.sharedUnknown as string;
  }
  if (offer.availability === 'limited') return words.limited as string;
  if (offer.availability === 'unavailable') return words.unavailable as string;
  if (offer.availability === 'incomplete') return words.incomplete as string;
  return words.available as string;
}

export function FlowScreen() {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Language>('es');
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedCategory, setSelectedCategory] = useState<OfferCategory | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tripItems, setTripItems] = useState<TripItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [serviceFeeRate, setServiceFeeRate] = useState<DemoServiceFeeRate>(
    DEFAULT_DEMO_SERVICE_FEE_RATE,
  );
  const [storageReady, setStorageReady] = useState(false);
  const [showPricingLab, setShowPricingLab] = useState(false);
  // Las fechas de servicio son de Búzios, no del dispositivo del turista.
  const today = useBuziosToday();
  const [draftDate, setDraftDate] = useState(today);
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [draftNights, setDraftNights] = useState(1);
  const words = copy[language];
  const catalog = useCatalog(SHARED_CATALOG_ENABLED);
  const selectedOffer = catalog.offers.find(offer => offer.id === selectedOfferId);
  // Solo las ofertas de ejemplo entran al viaje demo; las compartidas se reservan en el portal.
  const pricedItems = useMemo(
    () => priceTripItems(tripItems, catalog.offers.filter(offer => offer.source !== 'shared')),
    [tripItems, catalog.offers],
  );
  const policy = {
    ...DEFAULT_DEMO_PRICING_POLICY,
    serviceFeeRate,
  };
  const quote = calculateDemoQuote(pricedItems, policy);

  useEffect(() => {
    let active = true;
    loadDemoState().then(state => {
      if (!active) return;
      setTripItems(state.tripItems);
      setBookings(state.bookings as Booking[]);
      setServiceFeeRate(state.serviceFeeRate as DemoServiceFeeRate);
      setStorageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    saveDemoState({
      schemaVersion: 1,
      tripItems,
      bookings,
      serviceFeeRate,
    }).catch(error => console.warn('No se pudo guardar el viaje demo', error));
  }, [bookings, serviceFeeRate, storageReady, tripItems]);
  const matchingOffers = catalog.offers.filter(offer => {
    const categoryMatch = !selectedCategory || offer.category === selectedCategory;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const searchMatch =
      !normalizedQuery ||
      `${offer.title[language]} ${offer.location[language]}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return categoryMatch && searchMatch;
  });

  function openExplore(category?: OfferCategory | null) {
    setSelectedCategory(category ?? null);
    setQuery('');
    setScreen('explore');
  }

  function openOffer(offer: Offer) {
    setSelectedOfferId(offer.id);
    setDraftDate(today);
    setDraftQuantity(1);
    setDraftNights(1);
    setScreen('detail');
  }

  function addToTrip(offer: Offer) {
    if (offer.availability === 'unavailable' || offer.availability === 'incomplete') return;
    if (offer.source === 'shared') {
      // El viaje demo no consume cupo; una oferta real se cotiza y retiene en el portal.
      setScreen('operations');
      return;
    }
    setTripItems(items => [
      ...items,
      {
        id: `${offer.id}-${Date.now()}`,
        offerId: offer.id,
        date: draftDate,
        quantity: draftQuantity,
        nights: draftNights,
      },
    ]);
    setScreen('trip');
  }

  function updateTripItem(itemId: string, update: Partial<TripItem>) {
    setTripItems(items =>
      items.map(item => (item.id === itemId ? { ...item, ...update } : item)),
    );
  }

  function confirmBooking() {
    if (pricedItems.length === 0 || pricedItems.some(entry => entry.item.date < today)) return;
    const bookingId = `BF-DEMO-${String(bookings.length + 1).padStart(3, '0')}`;
    const payment = createPaymentIntent({
      bookingId,
      amountCents: quote.travelerTotalCents,
      travelerCountry: 'BR',
      travelerHasCpf: true,
      selectedProvider: selectGateway('simulated_gateway', 'simulated').gateway.id,
      method: 'visa',
      providerCommissionCents: quote.providerCommissionCents,
      travelerFeeCents: quote.serviceFeeCents,
      quoteVersion: quote.pricingVersion,
      settlementMode: quote.settlementMode,
      requiresAdditionalAuth: false,
    });
    const fxSummary = getInformativeFxQuote(quote.travelerTotalCents, 'USD');
    const booking = {
      id: bookingId,
      channel: 'app-demo' as const,
      confirmedAt: new Date().toISOString(),
      lines: pricedItems.map(({ item, offer, subtotalCents }) => ({
        item: { ...item },
        offerId: offer.id,
        title: { ...offer.title },
        location: { ...offer.location },
        category: offer.category,
        priceMode: offer.priceMode,
        priceUnit: offer.priceUnit ? { ...offer.priceUnit } : undefined,
        unitPriceCents: Math.round((offer.price ?? 0) * 100),
        subtotalCents,
      })),
      quote,
      payment,
      accounting: {
        settlementMode: quote.settlementMode,
        providerResponsible: 'proveedor local / conciliación B2B pendiente',
        netToProviderCents: quote.subtotalCents - quote.providerCommissionCents,
        grossIncomeCents: quote.grossIncomeCents,
        travelerFeeCents: quote.serviceFeeCents,
        providerCommissionCents: quote.providerCommissionCents,
        fxInformative: {
          currency: 'USD',
          amount: fxSummary.amount,
          rate: fxSummary.rate,
          source: fxSummary.source,
          validAt: fxSummary.validAt,
          validUntil: fxSummary.validUntil,
        },
      },
    } satisfies Booking;
    setBookings(current => [booking, ...current]);
    setTripItems([]);
    setScreen('confirmation');
  }

  function changeScreen(next: Screen) {
    setScreen(next);
    if (next === 'explore') setSelectedCategory(null);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 10,
            paddingBottom: insets.bottom + 92,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {screen === 'home' ? (
          <HomeView
            language={language}
            words={words}
            onLanguage={setLanguage}
            onCategory={category => openExplore(category)}
            onExplore={() => openExplore()}
            onOffer={openOffer}
            onOperations={() => setScreen('operations')}
            catalog={catalog}
          />
        ) : null}
        {screen === 'operations' ? (
          <ReservationPortal onClose={() => setScreen('home')} language={language} />
        ) : null}
        {screen === 'explore' ? (
          <ExploreView
            language={language}
            words={words}
            offers={matchingOffers}
            categories={catalog.categories}
            catalogSource={catalog.source}
            selectedCategory={selectedCategory}
            query={query}
            onQuery={setQuery}
            onCategory={setSelectedCategory}
            onOffer={openOffer}
            onBack={() => changeScreen('home')}
            onLanguage={setLanguage}
          />
        ) : null}
        {screen === 'detail' && selectedOffer ? (
          <DetailView
            offer={selectedOffer}
            language={language}
            words={words}
            date={draftDate}
            quantity={draftQuantity}
            nights={draftNights}
            onDate={setDraftDate}
            onQuantity={setDraftQuantity}
            onNights={setDraftNights}
            today={today}
            onAdd={() => addToTrip(selectedOffer)}
            addLabel={selectedOffer.source === 'shared' ? (words.bookInPortal as string) : (words.addTrip as string)}
            onBack={() => changeScreen('explore')}
          />
        ) : null}
        {screen === 'trip' ? (
          <TripView
            language={language}
            words={words}
            items={pricedItems}
            bookings={bookings}
            quote={quote}
            serviceFeeRate={serviceFeeRate}
            showPricingLab={showPricingLab}
            onServiceFeeRate={setServiceFeeRate}
            onTogglePricingLab={() => setShowPricingLab(value => !value)}
            onBack={() => changeScreen('home')}
            onUpdate={updateTripItem}
            onRemove={itemId => setTripItems(items => items.filter(item => item.id !== itemId))}
            onConfirm={confirmBooking}
            today={today}
            onBooking={booking => {
              setBookings(current => [booking, ...current.filter(item => item.id !== booking.id)]);
              setScreen('confirmation');
            }}
            onExplore={() => openExplore()}
          />
        ) : null}
        {screen === 'confirmation' && bookings[0] ? (
          <ConfirmationView
            booking={bookings[0]}
            language={language}
            words={words}
            onTrip={() => changeScreen('trip')}
            onExplore={() => openExplore()}
          />
        ) : null}
      </ScrollView>
      {screen !== 'confirmation' ? (
        <BottomNav
          screen={screen}
          words={words}
          tripCount={tripItems.length}
          onScreen={changeScreen}
        />
      ) : null}
    </View>
  );
}

type Words = typeof copy.es;

function Header({
  language,
  words,
  onLanguage,
  onBack,
}: {
  language: Language;
  words: Words;
  onLanguage?: (language: Language) => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button">
          <Icon name="chevron" size={19} color={colors.dark} />
        </Pressable>
      ) : null}
      <View style={styles.headerText}>
        <Text style={styles.brand}>CONNECTICAL VIAGENS</Text>
        <Text style={styles.location}>{words.location}</Text>
      </View>
      {onLanguage ? (
        <View style={styles.languageToggle}>
          {(['es', 'pt'] as const).map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: language === option }}
              onPress={() => onLanguage(option)}
              style={[styles.languageButton, language === option && styles.languageButtonActive]}
            >
              <Text style={[styles.languageText, language === option && styles.languageTextActive]}>
                {option.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CatalogNotice({ source, words }: { source: CatalogSource; words: Words }) {
  if (source === 'loading') return <Text style={styles.exampleCaption}>{words.catalogLoading}</Text>;
  if (source === 'demo_fallback') return <Text style={styles.exampleCaption}>{words.catalogFallback}</Text>;
  return null;
}

function HomeView({
  language,
  words,
  onLanguage,
  onCategory,
  onExplore,
  onOffer,
  onOperations,
  catalog,
}: {
  language: Language;
  words: Words;
  onLanguage: (language: Language) => void;
  onCategory: (category: OfferCategory) => void;
  onExplore: () => void;
  onOffer: (offer: Offer) => void;
  onOperations: () => void;
  catalog: Catalog & { source: CatalogSource };
}) {
  return (
    <>
      <Header language={language} words={words} onLanguage={onLanguage} />
      <View style={styles.hero}>
        <Text style={styles.heroKicker}>BÚZIOS · BRASIL</Text>
        <Text style={styles.heroTitle}>{words.title}</Text>
        <View style={styles.heroDetails}>
          <Text style={styles.heroSummary}>{catalog.activeOffers} {words.offerSummary}</Text>
          {catalog.maxDiscount > 0 ? (
            <View style={styles.savingsBadge}>
              <Text style={styles.savingsText}>{words.savings} {catalog.maxDiscount}%</Text>
            </View>
          ) : null}
        </View>
      </View>
      <CatalogNotice source={catalog.source} words={words} />
      <SectionHeading title={words.categories} trailing={String(catalog.categories.length).padStart(2, '0')} />
      <View style={styles.categoryGrid}>
        {catalog.categories.map(category => (
          <Pressable
            key={category.id}
            accessibilityRole="button"
            onPress={() => onCategory(category.id)}
            style={styles.homeCategory}
          >
            <Icon name={CATEGORY_ICONS[category.id]} size={21} color={colors.sea} />
            <Text style={styles.homeCategoryName}>{category.label[language]}</Text>
            <Text style={styles.categoryCount}>{category.count}{catalog.source === 'shared' ? '' : ' · demo'}</Text>
          </Pressable>
        ))}
      </View>
      <SectionHeading title={words.featured} trailing="BRL" />
      <View style={styles.offerList}>
        {catalog.offers.slice(0, 4).map(offer => (
          <View key={offer.id}>
            <OfferRow offer={offer} language={language} onPress={() => onOffer(offer)} />
            <Text style={styles.exampleCaption}>{offer.source === 'shared' ? words.sharedExample : words.example}</Text>
          </View>
        ))}
      </View>
      <PrimaryButton title={words.explore} onPress={onExplore} />
      <PrimaryButton title={words.operations as string} onPress={onOperations} />
    </>
  );
}

function ExploreView({
  language,
  words,
  offers,
  categories,
  catalogSource,
  selectedCategory,
  query,
  onQuery,
  onCategory,
  onOffer,
  onBack,
  onLanguage,
}: {
  language: Language;
  words: Words;
  offers: Offer[];
  categories: Catalog['categories'];
  catalogSource: CatalogSource;
  selectedCategory: OfferCategory | null;
  query: string;
  onQuery: (value: string) => void;
  onCategory: (category: OfferCategory | null) => void;
  onOffer: (offer: Offer) => void;
  onBack: () => void;
  onLanguage: (language: Language) => void;
}) {
  return (
    <>
      <Header language={language} words={words} onLanguage={onLanguage} onBack={onBack} />
      <Text style={styles.pageTitle}>{words.explore}</Text>
      <TextInput
        value={query}
        onChangeText={onQuery}
        placeholder={words.search as string}
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        accessibilityLabel={words.search as string}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterPill label={words.all as string} active={!selectedCategory} onPress={() => onCategory(null)} />
        {categories.map(category => (
          <FilterPill
            key={category.id}
            label={category.label[language]}
            active={selectedCategory === category.id}
            onPress={() => onCategory(selectedCategory === category.id ? null : category.id)}
          />
        ))}
      </ScrollView>
      <CatalogNotice source={catalogSource} words={words} />
      <Text style={styles.resultCount}>{offers.length} {catalogSource === 'shared' ? words.sharedResults : words.results}</Text>
      {offers.length ? (
        <View style={styles.offerList}>
          {offers.map(offer => (
            <View key={offer.id}>
              <OfferRow offer={offer} language={language} onPress={() => onOffer(offer)} />
              <View style={styles.offerMeta}>
                <Text style={styles.offerCategory}>{categoryName(offer.category, language)}</Text>
                <Text style={[
                  styles.availability,
                  offer.availability === 'unavailable' || offer.availability === 'incomplete'
                    ? styles.availabilityMuted
                    : null,
                ]}>
                  {availabilityLabel(offer, language)}
                </Text>
              </View>
              <Text style={styles.exampleCaption}>{words.example}</Text>
            </View>
          ))}
        </View>
      ) : (
        <EmptyState title={query ? words.noResults as string : words.noCategory as string} />
      )}
    </>
  );
}

function DetailView({
  offer,
  language,
  words,
  date,
  quantity,
  nights,
  onDate,
  onQuantity,
  onNights,
  onAdd,
  addLabel,
  onBack,
  today,
}: {
  offer: Offer;
  language: Language;
  words: Words;
  date: string;
  quantity: number;
  nights: number;
  onDate: (date: string) => void;
  onQuantity: (quantity: number) => void;
  onNights: (nights: number) => void;
  onAdd: () => void;
  addLabel: string;
  onBack: () => void;
  today: string;
}) {
  const canBook = offer.availability === 'available' || offer.availability === 'limited';
  const categorySpecific = [
    offer.schedule ? [words.schedule as string, offer.schedule[language]] : null,
    offer.duration ? [words.duration as string, offer.duration[language]] : null,
    offer.route ? [words.route as string, offer.route[language]] : null,
    offer.ticketType ? [words.ticket as string, offer.ticketType[language]] : null,
  ].filter((entry): entry is string[] => entry !== null);

  return (
    <>
      <Header language={language} words={words} onBack={onBack} />
      <View style={styles.detailArtwork}>
        <View style={styles.detailIcon}>
          <Icon name={offer.icon} size={38} color={colors.onDark} />
        </View>
        <Text style={styles.detailCategory}>{categoryName(offer.category, language).toUpperCase()}</Text>
        <Text style={styles.detailLocation}>{offer.location[language]}</Text>
      </View>
      <Text style={styles.demoLabel}>{offer.source === 'shared' ? words.sharedExample : words.example}</Text>
      <Text style={styles.detailTitle}>{offer.title[language]}</Text>
      <Text style={styles.detailAvailability}>{availabilityLabel(offer, language)}</Text>
      {offer.price !== undefined ? (
        <View style={styles.detailPriceRow}>
          <Text style={styles.detailPrice}>{brlFromCents(Math.round(offer.price * 100))}</Text>
          <Text style={styles.detailPriceUnit}>{offer.priceUnit?.[language]}</Text>
        </View>
      ) : null}
      <InfoSection title={words.about as string}>
        <Text style={styles.bodyText}>{offer.description[language]}</Text>
      </InfoSection>
      {offer.includes[language].length > 0 ? (
        <InfoSection title={words.includes as string}>
          {offer.includes[language].map(value => <Bullet key={value} text={value} />)}
        </InfoSection>
      ) : null}
      {categorySpecific.length > 0 ? (
        <InfoSection title={categoryName(offer.category, language)}>
          {categorySpecific.map(([label, value]) => <DetailFact key={label} label={label} value={value} />)}
          {offer.meetingPoint ? <DetailFact label={words.meeting as string} value={offer.meetingPoint[language]} /> : null}
        </InfoSection>
      ) : offer.meetingPoint ? (
        <InfoSection title={words.meeting as string}>
          <Text style={styles.bodyText}>{offer.meetingPoint[language]}</Text>
        </InfoSection>
      ) : null}
      <InfoSection title={words.conditions as string}>
        <Text style={styles.bodyText}>{offer.cancellation[language]}</Text>
      </InfoSection>
      {offer.missingFields ? (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>{words.missing}</Text>
          {offer.missingFields[language].map(value => <Bullet key={value} text={value} />)}
        </View>
      ) : null}
      {canBook && offer.source === 'shared' ? (
        <PrimaryButton title={addLabel} onPress={onAdd} />
      ) : canBook ? (
        <View style={styles.bookingControls}>
          <Text style={styles.controlLabel}>{offer.priceMode === 'night' ? words.stayDate : words.date}</Text>
          <DateStepper value={date} min={today} language={language} onChange={onDate} />
          {offer.priceMode === 'night' ? (
            <>
              <Text style={styles.controlLabel}>{words.rooms}</Text>
              <NumberStepper value={quantity} onChange={onQuantity} min={1} max={5} labels={[words.decreaseQuantity as string, words.increaseQuantity as string]} />
              <Text style={styles.controlLabel}>{words.nights}</Text>
              <NumberStepper value={nights} onChange={onNights} min={1} max={14} labels={[words.decreaseNights as string, words.increaseNights as string]} />
            </>
          ) : (
            <>
              <Text style={styles.controlLabel}>{words.quantity}</Text>
              <NumberStepper value={quantity} onChange={onQuantity} min={1} max={8} labels={[words.decreaseQuantity as string, words.increaseQuantity as string]} />
            </>
          )}
          <PrimaryButton title={addLabel} onPress={onAdd} />
        </View>
      ) : null}
    </>
  );
}

function TripView({
  language,
  words,
  items,
  bookings,
  quote,
  serviceFeeRate,
  showPricingLab,
  onServiceFeeRate,
  onTogglePricingLab,
  onBack,
  onUpdate,
  onRemove,
  onConfirm,
  today,
  onBooking,
  onExplore,
}: {
  language: Language;
  words: Words;
  items: ReturnType<typeof priceTripItems>;
  bookings: Booking[];
  quote: ReturnType<typeof calculateDemoQuote>;
  serviceFeeRate: DemoServiceFeeRate;
  showPricingLab: boolean;
  onServiceFeeRate: (rate: DemoServiceFeeRate) => void;
  onTogglePricingLab: () => void;
  onBack: () => void;
  onUpdate: (itemId: string, update: Partial<TripItem>) => void;
  onRemove: (itemId: string) => void;
  onConfirm: () => void;
  today: string;
  onBooking: (booking: Booking) => void;
  onExplore: () => void;
}) {
  return (
    <>
      <Header language={language} words={words} onBack={onBack} />
      <Text style={styles.pageTitle}>{words.trip}</Text>
      {items.length ? (
        <>
          <View style={styles.offerList}>
            {items.map(({ item, offer, subtotalCents }) => (
              <View key={item.id} style={styles.tripCard}>
                <View style={styles.tripCardHeading}>
                  <View style={styles.tripTitleWrap}>
                    <Text style={styles.tripCategory}>{categoryName(offer.category, language)}</Text>
                    <Text style={styles.tripTitle}>{offer.title[language]}</Text>
                    <Text style={styles.tripSubtitle}>{offer.location[language]}</Text>
                  </View>
                  <Pressable onPress={() => onRemove(item.id)} accessibilityRole="button" style={styles.removeButton}>
                    <Text style={styles.removeText}>{words.remove}</Text>
                  </Pressable>
                </View>
                <Text style={styles.controlLabel}>{offer.priceMode === 'night' ? words.stayDate : words.date}</Text>
                <DateStepper value={item.date} min={today} language={language} onChange={date => onUpdate(item.id, { date })} />
                {item.date < today ? <Text style={styles.warningTitle}>{words.pastDate}</Text> : null}
                {offer.priceMode === 'night' ? (
                  <>
                    <Text style={styles.controlLabel}>{words.rooms}</Text>
                    <NumberStepper value={item.quantity} min={1} max={5} onChange={quantity => onUpdate(item.id, { quantity })} labels={[words.decreaseQuantity as string, words.increaseQuantity as string]} />
                    <Text style={styles.controlLabel}>{words.nights}</Text>
                    <NumberStepper value={item.nights} min={1} max={14} onChange={nights => onUpdate(item.id, { nights })} labels={[words.decreaseNights as string, words.increaseNights as string]} />
                  </>
                ) : (
                  <>
                    <Text style={styles.controlLabel}>{quantityUnit(offer, words)}</Text>
                    <NumberStepper value={item.quantity} min={1} max={8} onChange={quantity => onUpdate(item.id, { quantity })} labels={[words.decreaseQuantity as string, words.increaseQuantity as string]} />
                  </>
                )}
                <View style={styles.lineTotal}>
                  <Text style={styles.bodyText}>{words.subtotal}</Text>
                  <Text style={styles.lineAmount}>{brlFromCents(subtotalCents)}</Text>
                </View>
                {offer.providerCommissionRate !== undefined ? (
                  <Text style={styles.commissionNote}>
                    {words.commissionLabel}: {Math.round(offer.providerCommissionRate * 100)}% · {words.notIncluded}
                  </Text>
                ) : offer.category === 'buggy' ? (
                  <Text style={styles.commissionNote}>{words.providerPending}</Text>
                ) : null}
              </View>
            ))}
          </View>
          <TotalsPanel words={words} quote={quote} />
          <Pressable onPress={onTogglePricingLab} style={styles.labToggle} accessibilityRole="button">
            <Text style={styles.labToggleText}>{words.pricingLab}</Text>
            <Text style={styles.labToggleText}>{showPricingLab ? '−' : '+'}</Text>
          </Pressable>
          {showPricingLab ? (
            <PricingLab
              words={words}
              items={items}
              quote={quote}
              selectedRate={serviceFeeRate}
              onRate={onServiceFeeRate}
            />
          ) : null}
          <PrimaryButton
            title={words.confirm as string}
            onPress={onConfirm}
            disabled={items.some(({ item }) => item.date < today)}
          />
        </>
      ) : (
        <EmptyState title={words.emptyTrip as string} note={words.emptyTripNote as string} action={words.explore as string} onAction={onExplore} />
      )}
      <SectionHeading title={words.bookingHistory as string} trailing={String(bookings.length)} />
      {bookings.length ? bookings.map(booking => (
        <Pressable
          key={booking.id}
          onPress={() => onBooking(booking)}
          style={styles.bookingHistoryRow}
          accessibilityRole="button"
        >
          <View>
            <Text style={styles.tripTitle}>{booking.id}</Text>
            <Text style={styles.tripSubtitle}>{booking.lines.length} · {words.example}</Text>
          </View>
          <Text style={styles.lineAmount}>{brlFromCents(booking.quote.travelerTotalCents)}</Text>
        </Pressable>
      )) : <Text style={styles.mutedNote}>{words.noBookings}</Text>}
    </>
  );
}

function ConfirmationView({
  booking,
  language,
  words,
  onTrip,
  onExplore,
}: {
  booking: Booking;
  language: Language;
  words: Words;
  onTrip: () => void;
  onExplore: () => void;
}) {
  return (
    <>
      <View style={styles.confirmHero}>
        <Text style={styles.confirmMark}>✓</Text>
        <Text style={styles.confirmTitle}>{words.confirmation}</Text>
        <Text style={styles.confirmNote}>{words.demoConfirmed}</Text>
      </View>
      {booking.payment ? (
        <View style={styles.paymentSummaryBox}>
          <Text style={styles.paymentSummaryTitle}>{words.simulatedPayment} · {PAYMENT_STATE_LABELS[language][booking.payment.state]}</Text>
          <Text style={styles.paymentSummaryText}>
            {words.brlOperation} · {booking.accounting?.settlementMode === 'split_authorized' ? words.splitAuthorized : words.b2bConciliation}
          </Text>
          {booking.accounting ? (
            <Text style={styles.paymentSummaryText}>
              {words.demoFx}: US$ {booking.accounting.fxInformative.amount.toFixed(2)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.demoLabel}>{words.bookingCode}: {booking.id} · {booking.quote.pricingVersion}</Text>
      <SectionHeading title={words.trip} trailing={String(booking.lines.length)} />
      <View style={styles.offerList}>
        {booking.lines.map(line => (
          <View key={line.item.id} style={styles.confirmItem}>
            <Text style={styles.tripCategory}>{formatDate(line.item.date, language)} · {categoryName(line.category, language)}</Text>
            <Text style={styles.tripTitle}>{line.title[language]}</Text>
            <Text style={styles.tripSubtitle}>
              {quantityDescription(line.item, line.priceMode, words)} · {brlFromCents(line.subtotalCents)}
              {line.priceUnit ? ` · ${line.priceUnit[language]}` : ''}
            </Text>
          </View>
        ))}
      </View>
      <TotalsPanel words={words} quote={booking.quote} />
      <PrimaryButton title={words.backTrip as string} onPress={onTrip} />
      <SecondaryButton title={words.backHome as string} onPress={onExplore} />
    </>
  );
}

function quantityUnit(offer: Offer, words: Words) {
  if (offer.priceMode === 'person') return words.unitPeople as string;
  if (offer.priceMode === 'ticket') return words.unitTickets as string;
  if (offer.priceMode === 'group') return words.unitGroups as string;
  return words.unitRooms as string;
}

function quantityDescription(
  item: TripItem,
  priceMode: Offer['priceMode'],
  words: Words,
) {
  if (priceMode === 'night') return `${item.quantity} ${words.unitRooms} · ${item.nights} ${words.nights}`;
  if (priceMode === 'person') return `${item.quantity} ${words.unitPeople}`;
  if (priceMode === 'ticket') return `${item.quantity} ${words.unitTickets}`;
  return `${item.quantity} ${words.unitGroups}`;
}

function TotalsPanel({
  words,
  quote,
}: {
  words: Words;
  quote: ReturnType<typeof calculateDemoQuote>;
}) {
  return (
    <View style={styles.totalsPanel}>
      <TotalRow label={words.subtotal as string} value={brlFromCents(quote.subtotalCents)} />
      <TotalRow label={`${words.serviceFee} · ${quote.serviceFeeRate / 100}%`} value={brlFromCents(quote.serviceFeeCents)} />
      <View style={styles.totalDivider} />
      <TotalRow label={words.total as string} value={brlFromCents(quote.travelerTotalCents)} strong />
    </View>
  );
}

function PricingLab({
  words,
  items,
  quote,
  selectedRate,
  onRate,
}: {
  words: Words;
  items: ReturnType<typeof priceTripItems>;
  quote: ReturnType<typeof calculateDemoQuote>;
  selectedRate: DemoServiceFeeRate;
  onRate: (rate: DemoServiceFeeRate) => void;
}) {
  return (
    <View style={styles.pricingLab}>
      <Text style={styles.labDisclaimer}>{words.internalOnly}</Text>
      <View style={styles.rateRow}>
        {DEMO_SERVICE_FEE_RATES.map(rate => {
          const scenarioQuote = calculateDemoQuote(items, {
            ...DEFAULT_DEMO_PRICING_POLICY,
            serviceFeeRate: rate,
          });
          const active = rate === selectedRate;
          return (
            <Pressable
              key={rate}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onRate(rate)}
              style={[styles.rateOption, active && styles.rateOptionActive]}
            >
              <Text style={[styles.rateLabel, active && styles.rateLabelActive]}>
                {rate === DEFAULT_DEMO_SERVICE_FEE_RATE ? `${words.baseCase} ` : ''}{rate / 100}%
              </Text>
              <Text style={[styles.rateTotal, active && styles.rateLabelActive]}>
                {brlFromCents(scenarioQuote.travelerTotalCents)}
              </Text>
              <Text style={[styles.rateMargin, active && styles.rateLabelActive]}>
                {brlFromCents(scenarioQuote.contributionMarginCents)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.labSectionTitle}>{words.pricingLab}</Text>
      <InternalRow label={words.grossIncome as string} value={quote.grossIncomeCents} />
      <InternalRow label={words.commissionRates as string} value={quote.providerCommissionCents} />
      <InternalRow label={words.gatewayCost as string} value={-quote.gatewayCostCents} />
      <InternalRow label={words.conversionCost as string} value={-quote.conversionCostCents} />
      <InternalRow label={words.operatingReserve as string} value={-quote.operatingReserveCents} />
      <View style={styles.totalDivider} />
      <InternalRow label={words.contributionMargin as string} value={quote.contributionMarginCents} strong />
      <View style={styles.commissionReference}>
        <Text style={styles.commissionReferenceTitle}>{words.commissionRates}</Text>
        <Text style={styles.commissionReferenceText}>{words.commissionSummary}</Text>
        <Text style={styles.commissionReferenceText}>{words.buggyCommission}</Text>
      </View>
    </View>
  );
}

function InternalRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={styles.internalRow}>
      <Text style={[styles.internalLabel, strong && styles.internalStrong]}>{label}</Text>
      <Text style={[styles.internalValue, strong && styles.internalStrong]}>{brlFromCents(value)}</Text>
    </View>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

function SectionHeading({ title, trailing }: { title: string; trailing?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {trailing ? <Text style={styles.sectionTrailing}>{trailing}</Text> : null}
    </View>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.filterPill, active && styles.filterPillActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DateStepper({
  value,
  min,
  language,
  onChange,
}: {
  value: string;
  min: string;
  language: Language;
  onChange: (value: string) => void;
}) {
  const words = copy[language];
  const previous = moveDate(value, -1);
  // Una fecha guardada que ya pasó salta a hoy con cualquiera de los dos botones.
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(previous < min ? min : previous)}
        disabled={value === min}
        accessibilityState={{ disabled: value === min }}
        style={[styles.stepperButton, value <= min && styles.buttonDisabled]}
        accessibilityLabel={words.previousDay as string}
      >
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{formatDate(value, language)}</Text>
      <Pressable onPress={() => onChange(value < min ? min : moveDate(value, 1))} style={styles.stepperButton} accessibilityLabel={words.nextDay as string}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
  labels,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labels: [decrease: string, increase: string];
}) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepperButton} accessibilityLabel={labels[0]}>
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={styles.stepperButton} accessibilityLabel={labels[1]}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.infoSection}>
      <Text style={styles.infoTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bullet} />
      <Text style={styles.bodyText}>{text}</Text>
    </View>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function EmptyState({ title, note, action, onAction }: { title: string; note?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {note ? <Text style={styles.emptyNote}>{note}</Text> : null}
      {action && onAction ? <PrimaryButton title={action} onPress={onAction} /> : null}
    </View>
  );
}

function PrimaryButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryButton, disabled && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}
    >
      <Text style={styles.primaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.secondaryButton}>
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
  );
}

function BottomNav({
  screen,
  words,
  tripCount,
  onScreen,
}: {
  screen: Screen;
  words: Words;
  tripCount: number;
  onScreen: (screen: Screen) => void;
}) {
  const tabs: { id: Screen; label: string; icon: 'bed' | 'search' | 'boat' }[] = [
    { id: 'home', label: words.home as string, icon: 'bed' },
    { id: 'explore', label: words.explore as string, icon: 'search' },
    { id: 'trip', label: words.tripTab as string, icon: 'boat' },
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map(tab => {
        const active = screen === tab.id || (screen === 'detail' && tab.id === 'explore');
        return (
          <Pressable
            key={tab.id}
            onPress={() => onScreen(tab.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={styles.navItem}
          >
            <View style={styles.navIconWrap}>
              <Icon name={tab.icon} size={18} color={active ? colors.sea : colors.muted} />
              {tab.id === 'trip' && tripCount > 0 ? <View style={styles.navDot} /> : null}
            </View>
            <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
              {tab.id === 'trip' ? words.tripTab : tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '180deg' }], backgroundColor: colors.card, borderRadius: radius.pill },
  headerText: { flex: 1 },
  brand: { fontSize: 10, fontWeight: '700', color: colors.dark, letterSpacing: 1 },
  location: { marginTop: 3, fontSize: 11, color: colors.muted },
  languageToggle: { height: 36, flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: radius.pill, backgroundColor: colors.card },
  languageButton: { minWidth: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  languageButtonActive: { backgroundColor: colors.dark },
  languageText: { fontSize: 10, fontWeight: '600', color: colors.muted },
  languageTextActive: { color: colors.onDark },
  hero: { marginTop: 18, padding: 20, borderRadius: radius.card, backgroundColor: colors.dark },
  heroKicker: { fontSize: 10, fontWeight: '600', color: colors.sand, letterSpacing: 1 },
  heroTitle: { marginTop: 12, fontSize: 31, lineHeight: 38, fontFamily: 'Georgia', color: colors.onDark },
  heroDetails: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroSummary: { flexShrink: 1, fontSize: 12, color: colors.onDark },
  savingsBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
  savingsText: { fontSize: 11, fontWeight: '700', color: colors.onDark },
  sectionHeading: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  sectionTrailing: { fontSize: 11, fontWeight: '600', color: colors.muted },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  homeCategory: { width: '48%', minHeight: 88, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, borderRadius: radius.card },
  homeCategoryName: { marginTop: 5, fontSize: 14, fontWeight: '600', color: colors.text },
  categoryCount: { marginTop: 2, fontSize: 10, color: colors.muted },
  offerList: { gap: 8 },
  exampleCaption: { marginTop: 4, marginLeft: 12, fontSize: 8, fontWeight: '600', color: colors.muted, letterSpacing: 0.5 },
  primaryButton: { minHeight: 52, marginTop: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.dark, borderRadius: radius.pill },
  primaryButtonText: { fontSize: 15, fontWeight: '600', color: colors.onDark },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.78 },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 76, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.sand, backgroundColor: colors.background },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  navIconWrap: { position: 'relative', width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  navDot: { position: 'absolute', top: 0, right: 0, width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.accent },
  navLabel: { maxWidth: '100%', fontSize: 9, color: colors.muted },
  navLabelActive: { fontWeight: '700', color: colors.sea },
  pageTitle: { marginTop: 20, marginBottom: 12, fontSize: 26, lineHeight: 32, fontFamily: 'Georgia', color: colors.text },
  searchInput: { height: 46, paddingHorizontal: 15, backgroundColor: colors.card, borderRadius: radius.pill, fontSize: 14, color: colors.text },
  filterRow: { gap: 7, paddingVertical: 13 },
  filterPill: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.card },
  filterPillActive: { backgroundColor: colors.sea },
  filterText: { fontSize: 12, fontWeight: '600', color: colors.text },
  filterTextActive: { color: colors.onDark },
  resultCount: { marginBottom: 10, fontSize: 11, color: colors.muted },
  offerMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 6 },
  offerCategory: { fontSize: 10, fontWeight: '600', color: colors.sea },
  availability: { fontSize: 10, color: colors.sea },
  availabilityMuted: { color: colors.accent },
  emptyState: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 },
  emptyTitle: { textAlign: 'center', fontSize: 18, fontWeight: '600', color: colors.text },
  emptyNote: { marginTop: 8, textAlign: 'center', fontSize: 13, lineHeight: 19, color: colors.muted },
  detailArtwork: { minHeight: 150, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: colors.sea },
  detailIcon: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  detailCategory: { marginTop: 10, fontSize: 10, fontWeight: '700', color: colors.sand, letterSpacing: 1 },
  detailLocation: { marginTop: 4, fontSize: 12, color: colors.onDark },
  demoLabel: { marginTop: 14, fontSize: 9, fontWeight: '700', color: colors.accent, letterSpacing: 0.7 },
  detailTitle: { marginTop: 6, fontSize: 27, lineHeight: 33, fontFamily: 'Georgia', color: colors.text },
  detailAvailability: { marginTop: 6, fontSize: 12, fontWeight: '600', color: colors.sea },
  detailPriceRow: { marginTop: 12, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  detailPrice: { fontSize: 22, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  detailPriceUnit: { fontSize: 12, color: colors.muted },
  infoSection: { marginTop: 19, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.sand },
  infoTitle: { marginBottom: 8, fontSize: 14, fontWeight: '700', color: colors.text },
  bodyText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 5 },
  bullet: { width: 5, height: 5, marginTop: 7, borderRadius: radius.pill, backgroundColor: colors.accent },
  factRow: { paddingVertical: 5 },
  factLabel: { fontSize: 10, fontWeight: '600', color: colors.muted },
  factValue: { marginTop: 2, fontSize: 13, color: colors.text },
  warningBox: { marginTop: 14, padding: 14, borderRadius: radius.card, backgroundColor: '#F7E5D9' },
  warningTitle: { marginBottom: 8, fontSize: 13, fontWeight: '700', color: colors.text },
  bookingControls: { marginTop: 20, paddingTop: 15, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.sand },
  controlLabel: { marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '600', color: colors.text },
  stepper: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: colors.card },
  stepperButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.iconSoft },
  stepperSign: { fontSize: 21, lineHeight: 24, color: colors.dark },
  stepperValue: { fontSize: 14, fontWeight: '600', color: colors.text },
  tripCard: { padding: 14, borderRadius: radius.card, backgroundColor: colors.card },
  tripCardHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  tripTitleWrap: { flex: 1 },
  tripCategory: { fontSize: 10, fontWeight: '700', color: colors.sea },
  tripTitle: { marginTop: 3, fontSize: 15, fontWeight: '600', color: colors.text },
  tripSubtitle: { marginTop: 3, fontSize: 11, color: colors.muted },
  removeButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  removeText: { fontSize: 11, fontWeight: '600', color: colors.accent },
  lineTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.sand },
  lineAmount: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  commissionNote: { marginTop: 7, fontSize: 9, lineHeight: 14, color: colors.muted },
  totalsPanel: { marginTop: 15, padding: 15, borderRadius: radius.card, backgroundColor: colors.card },
  totalRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  totalLabel: { flexShrink: 1, fontSize: 12, color: colors.muted },
  totalValue: { fontSize: 13, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  totalDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6, backgroundColor: colors.sand },
  totalStrong: { fontSize: 15, fontWeight: '700', color: colors.dark },
  mutedNote: { paddingVertical: 8, fontSize: 12, color: colors.muted },
  bookingHistoryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, marginBottom: 7, borderRadius: radius.card, backgroundColor: colors.card },
  paymentSummaryBox: { marginTop: 12, padding: 12, borderRadius: radius.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.sand },
  paymentSummaryTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  paymentSummaryText: { marginTop: 4, fontSize: 11, color: colors.muted },
  confirmHero: { marginTop: 20, padding: 22, alignItems: 'center', borderRadius: radius.card, backgroundColor: colors.dark },
  confirmMark: { width: 48, height: 48, textAlign: 'center', textAlignVertical: 'center', borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.sea, color: colors.onDark, fontSize: 27, fontWeight: '700' },
  confirmTitle: { marginTop: 13, textAlign: 'center', fontSize: 25, fontFamily: 'Georgia', color: colors.onDark },
  confirmNote: { marginTop: 9, textAlign: 'center', fontSize: 11, lineHeight: 16, color: colors.sand },
  confirmItem: { padding: 13, borderRadius: radius.card, backgroundColor: colors.card },
  secondaryButton: { minHeight: 48, marginTop: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', color: colors.text },
  labToggle: { minHeight: 44, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, borderRadius: radius.card, backgroundColor: colors.sand },
  labToggleText: { fontSize: 12, fontWeight: '700', color: colors.text },
  pricingLab: { marginTop: 8, padding: 14, borderRadius: radius.card, backgroundColor: '#E8EFE8' },
  labDisclaimer: { marginBottom: 10, fontSize: 10, fontWeight: '600', color: colors.muted },
  rateRow: { flexDirection: 'row', gap: 6 },
  rateOption: { flex: 1, minHeight: 60, justifyContent: 'center', alignItems: 'center', gap: 4, padding: 5, borderRadius: radius.card, backgroundColor: colors.card },
  rateOptionActive: { backgroundColor: colors.sea },
  rateLabel: { fontSize: 11, fontWeight: '700', color: colors.text },
  rateLabelActive: { color: colors.onDark },
  rateTotal: { fontSize: 10, fontWeight: '600', color: colors.muted },
  rateMargin: { fontSize: 8, fontWeight: '600', color: colors.sea, fontVariant: ['tabular-nums'] },
  labSectionTitle: { marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: '700', color: colors.text },
  internalRow: { minHeight: 25, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  internalLabel: { flex: 1, fontSize: 10, color: colors.muted },
  internalValue: { fontSize: 10, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  internalStrong: { fontSize: 12, fontWeight: '700', color: colors.dark },
  commissionReference: { marginTop: 10, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.sand },
  commissionReferenceTitle: { marginBottom: 4, fontSize: 10, fontWeight: '700', color: colors.text },
  commissionReferenceText: { fontSize: 9, lineHeight: 14, color: colors.muted },
});