import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { AdminConsole } from '../src/screens/AdminConsole';
import { TravelerServices } from '../src/screens/TravelerServices';
import * as platform from '../src/lib/platformService';
import type { SharedReservation } from '../src/lib/reservationService';

jest.mock('../src/lib/insforge', () => ({ insforge: null, sessionManager: null }));
jest.mock('../src/lib/platformService', () => {
  const names = [
    'getPlatformKpis', 'listAuditLog', 'listCampaigns', 'listIncidents', 'listOffersForModeration', 'listPlatformUsers',
    'listProviderApplications', 'reviewProviderApplication', 'saveCampaign', 'setOfferModeration', 'updateIncident',
    'getMyProviderApplication', 'listMyIncidents', 'reportIncident', 'submitProviderApplication',
  ];
  return Object.fromEntries(names.map(name => [name, jest.fn()]));
});

const mocked = platform as jest.Mocked<typeof platform>;

// Reproduce el `run` del portal: ejecuta la acción y muestra el resultado o el error.
function Harness({ children }: { children: (props: { busy: boolean; run: (action: () => Promise<string | void>) => void }) => React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<string | void>) => {
    setBusy(true);
    setMessage('');
    action()
      .then(result => setMessage(result ?? ''))
      .catch(error => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };
  return <>{children({ busy, run })}<Text>{`message:${message}`}</Text></>;
}

function flatten(children: unknown): string {
  if (Array.isArray(children)) return children.map(flatten).join('');
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children);
}
const texts = (root: ReactTestInstance) => root.findAllByType(Text).map(node => flatten(node.props.children));
const hasText = (root: ReactTestInstance, value: string) => texts(root).some(text => text.includes(value));

async function press(root: ReactTestInstance, label: string) {
  const node = root.findAllByType(Text).find(item => flatten(item.props.children) === label);
  if (!node) throw new Error(`Text not found: ${label}\n${texts(root).join('\n')}`);
  let parent = node.parent;
  while (parent && typeof parent.props.onPress !== 'function') parent = parent.parent;
  await ReactTestRenderer.act(async () => parent?.props.onPress());
}

async function type(root: ReactTestInstance, label: string, value: string) {
  const input = root.findAll(node => node.type === TextInput && node.props.accessibilityLabel === label)[0];
  if (!input) throw new Error(`Input not found: ${label}`);
  await ReactTestRenderer.act(async () => input.props.onChangeText(value));
}

async function renderAdmin(language: 'es' | 'pt' = 'es') {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<Harness>{props => <AdminConsole language={language} {...props} />}</Harness>);
  });
  return renderer.root;
}

const application: platform.ProviderApplication = {
  id: 'app-1', business_name: 'Pousada Mar', category: 'pousadas', status: 'pending', review_note: '',
  created_at: '2099-01-01T00:00:00Z', reviewed_at: null, contact_name: 'Ana', contact_phone: '+55 22 99999-0000',
  contact_email: 'ana@example.com', location: 'Geribá', description: 'Seis quartos',
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.listProviderApplications.mockResolvedValue([application]);
  mocked.getMyProviderApplication.mockResolvedValue(null);
  mocked.listMyIncidents.mockResolvedValue([]);
});

it('approves an application only with an explicit commission and rejects with a reason', async () => {
  mocked.reviewProviderApplication.mockResolvedValue({ ...application, status: 'approved' });
  const root = await renderAdmin();
  await press(root, 'Solicitudes');
  expect(hasText(root, 'Pousada Mar · Pousadas')).toBe(true);
  expect(hasText(root, 'Ana · +55 22 99999-0000 · ana@example.com')).toBe(true);
  await press(root, 'Aprobar / Rechazar');
  await press(root, 'Aprobar');
  expect(hasText(root, 'message:La comisión debe estar entre 0 % y 100 %.')).toBe(true);
  expect(mocked.reviewProviderApplication).not.toHaveBeenCalled();

  await type(root, 'Comisión acordada (%), obligatoria para aprobar', '12,5');
  await press(root, 'Aprobar');
  expect(mocked.reviewProviderApplication).toHaveBeenCalledWith({ applicationId: 'app-1', decision: 'approved', note: '', commissionRateBps: 1250 });
  expect(hasText(root, 'message:Solicitud revisada.')).toBe(true);

  await press(root, 'Aprobar / Rechazar');
  await type(root, 'Nota de revisión (obligatoria para rechazar)', ' Falta alvará ');
  await press(root, 'Rechazar');
  expect(mocked.reviewProviderApplication).toHaveBeenLastCalledWith({ applicationId: 'app-1', decision: 'rejected', note: 'Falta alvará', commissionRateBps: null });
});

it('suspends with a reason and restores publications', async () => {
  mocked.listOffersForModeration.mockResolvedValue([
    { offer_id: 'o1', title: 'Escuna', category: 'barcos', provider_name: 'Lab', published: true, moderation_status: 'approved', moderation_note: '', updated_at: '' },
    { offer_id: 'o2', title: 'Buggy', category: 'buggy', provider_name: 'Lab', published: true, moderation_status: 'suspended', moderation_note: 'Fotos', updated_at: '' },
  ]);
  mocked.setOfferModeration.mockResolvedValue('suspended');
  const root = await renderAdmin('pt');
  await press(root, 'Publicações');
  expect(hasText(root, 'Buggy · suspensa · Fotos')).toBe(true);
  await press(root, 'Reativar');
  expect(mocked.setOfferModeration).toHaveBeenCalledWith('o2', 'approved', '');
  await press(root, 'Suspender');
  await type(root, 'Motivo da suspensão', 'Preço enganoso');
  await press(root, 'Suspender');
  expect(mocked.setOfferModeration).toHaveBeenLastCalledWith('o1', 'suspended', 'Preço enganoso');
});

it('triages incidents and shows KPIs, users, audit entries and content-only campaigns', async () => {
  mocked.listIncidents.mockResolvedValue([{ id: 'i1', reservation_id: null, reporter_name: 'Tom', category: 'payment', description: 'Cobro duplicado', status: 'open', admin_note: '', created_at: '', updated_at: '' }]);
  mocked.updateIncident.mockResolvedValue('resolved');
  mocked.getPlatformKpis.mockResolvedValue({ quotes: 40, reservations: 12, confirmed: 10, cancelled: 1, expired: 1, refunded: 0, confirmed_gross_cents: 678400, service_fee_cents: 38400, commission_cents: 64000, refunded_cents: 0, quote_to_confirmed_bps: 2500 });
  mocked.listPlatformUsers.mockResolvedValue([{ user_id: 'u1', display_name: 'Ana', country_code: 'BR', role: 'provider', email: 'ana@example.com', created_at: '' }]);
  mocked.listAuditLog.mockResolvedValue([{ id: 1, actor_user_id: null, action: 'role_changed', target_table: 'connectical_profiles', target_id: 'u1', details: {}, created_at: '2099-01-01T00:00:00Z' }]);
  mocked.listCampaigns.mockResolvedValue([{ id: 'c1', title: 'Verão', body: '', category: null, starts_on: '2099-01-01', ends_on: '2099-01-10', status: 'draft' }]);
  mocked.saveCampaign.mockResolvedValue('c1');
  const root = await renderAdmin();

  await press(root, 'Incidencias');
  await press(root, 'Resolver');
  await type(root, 'Respuesta para quien la reportó', 'Reembolso registrado');
  await press(root, 'Resolver');
  expect(mocked.updateIncident).toHaveBeenCalledWith('i1', 'resolved', 'Reembolso registrado');

  await press(root, 'Indicadores');
  expect(hasText(root, 'Cotización → confirmada: 25 %')).toBe(true);
  expect(hasText(root, 'Bruto confirmado: R$ 6.784,00')).toBe(true);

  await press(root, 'Usuarios');
  expect(hasText(root, 'Ana · proveedor')).toBe(true);
  expect(hasText(root, 'Los roles de administración se asignan desde el SQL Editor')).toBe(true);

  await press(root, 'Actividad');
  expect(hasText(root, 'role_changed · profiles')).toBe(true);
  expect(hasText(root, 'sistema o SQL Editor')).toBe(true);

  await press(root, 'Campañas');
  expect(hasText(root, 'Solo contenido: una campaña no cambia precios ni comisiones.')).toBe(true);
  await press(root, 'Activar');
  expect(mocked.saveCampaign).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', status: 'active' }));
  await type(root, 'Desde (AAAA-MM-DD)', '2099-02-30');
  await press(root, 'Guardar campaña');
  expect(hasText(root, 'message:La fecha no existe en el calendario.')).toBe(true);
});

async function renderTraveler(role: 'traveler' | 'provider', reservations: SharedReservation[] = []) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <Harness>{props => <TravelerServices language="es" role={role} reservations={reservations} {...props} />}</Harness>,
    );
  });
  return renderer.root;
}

it('lets a traveler apply as provider, shows the review and allows reapplying after a rejection', async () => {
  mocked.submitProviderApplication.mockResolvedValue('app-1');
  mocked.getMyProviderApplication
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...application, status: 'pending' });
  let root = await renderTraveler('traveler');
  await type(root, 'Nombre del establecimiento', ' Pousada Mar ');
  await type(root, 'Persona de contacto', 'Ana');
  await type(root, 'Teléfono (con código de país)', '+55 22 99999-0000');
  await type(root, 'Correo de contacto', 'ana@example.com');
  await type(root, 'Ubicación en Búzios', 'Geribá');
  await press(root, 'Enviar solicitud');
  expect(mocked.submitProviderApplication).toHaveBeenCalledWith(expect.objectContaining({ businessName: 'Pousada Mar', category: 'pousadas' }));
  expect(hasText(root, 'Tu solicitud: Pousada Mar · pendiente')).toBe(true);
  expect(hasText(root, 'Enviar solicitud')).toBe(false);

  mocked.getMyProviderApplication.mockResolvedValueOnce({ ...application, status: 'rejected', review_note: 'Falta alvará' });
  root = await renderTraveler('traveler');
  expect(hasText(root, 'Falta alvará')).toBe(true);
  expect(hasText(root, 'Enviar solicitud')).toBe(true);
});

it('hides the provider application from providers and reports incidents on a chosen reservation', async () => {
  mocked.reportIncident.mockResolvedValue('i1');
  mocked.listMyIncidents.mockResolvedValueOnce([]).mockResolvedValueOnce([
    { id: 'i1', reservation_id: 'r-12345678', category: 'safety', description: 'Colete salva-vidas rasgado', status: 'open', admin_note: '', created_at: '', updated_at: '' },
  ]);
  const root = await renderTraveler('provider', [{ id: 'r-12345678-aaaa', service_date: '2099-01-10' } as SharedReservation]);
  expect(hasText(root, '¿Tienes un negocio turístico en Búzios?')).toBe(false);
  await press(root, 'Seguridad');
  await press(root, '2099-01-10 · r-123456');
  await type(root, 'Qué ocurrió', 'Colete salva-vidas rasgado');
  await press(root, 'Enviar incidencia');
  expect(mocked.reportIncident).toHaveBeenCalledWith({ reservationId: 'r-12345678-aaaa', category: 'safety', description: 'Colete salva-vidas rasgado' });
  expect(hasText(root, 'Seguridad · abierta')).toBe(true);
});
