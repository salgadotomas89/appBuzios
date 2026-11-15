import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Chip, Field, portalStyles as styles } from '../components/PortalControls';
import type { Language } from '../data/homeMock';
import { portalCopy, type PortalCategory } from '../i18n/portalCopy';
import { platformCopy } from '../i18n/platformCopy';
import {
  getMyProviderApplication,
  listMyIncidents,
  reportIncident,
  submitProviderApplication,
  type IncidentCategory,
  type MyIncident,
  type MyProviderApplication,
} from '../lib/platformService';
import type { SharedReservation, SharedRole } from '../lib/reservationService';

const CATEGORIES: PortalCategory[] = ['pousadas', 'barcos', 'noche', 'buggy', 'experiencias'];
const INCIDENT_CATEGORIES: IncidentCategory[] = ['service', 'payment', 'safety', 'access', 'other'];
const EMPTY_APPLICATION = { businessName: '', contactName: '', contactPhone: '', contactEmail: '', location: '', description: '' };

// Alta como proveedor (solo turistas) e incidencias (turistas y proveedores). El servidor decide
// permisos y estados; esta pantalla solo envía y muestra lo que la base de datos devuelve.
export function TravelerServices({
  language,
  role,
  reservations,
  busy,
  run,
}: {
  language: Language;
  role: SharedRole;
  reservations: SharedReservation[];
  busy: boolean;
  run: (action: () => Promise<string | void>) => void;
}) {
  const words = platformCopy[language];
  const portalWords = portalCopy[language];
  const [application, setApplication] = useState<MyProviderApplication | null>(null);
  const [draft, setDraft] = useState(EMPTY_APPLICATION);
  const [category, setCategory] = useState<PortalCategory>('pousadas');
  const [incidents, setIncidents] = useState<MyIncident[]>([]);
  const [incidentCategory, setIncidentCategory] = useState<IncidentCategory>('service');
  const [incidentReservation, setIncidentReservation] = useState<string | null>(null);
  const [incidentText, setIncidentText] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const [mine, myIncidents] = await Promise.all([
        role === 'traveler' ? getMyProviderApplication().catch(() => null) : Promise.resolve(null),
        listMyIncidents().catch(() => []),
      ]);
      if (!active) return;
      setApplication(mine);
      setIncidents(myIncidents);
    })();
    return () => {
      active = false;
    };
  }, [role]);

  function apply() {
    run(async () => {
      await submitProviderApplication({
        businessName: draft.businessName.trim(),
        category,
        contactName: draft.contactName.trim(),
        contactPhone: draft.contactPhone.trim(),
        contactEmail: draft.contactEmail.trim(),
        location: draft.location.trim(),
        description: draft.description.trim(),
      });
      setApplication(await getMyProviderApplication());
      setDraft(EMPTY_APPLICATION);
      return words.applicationSent;
    });
  }

  function report() {
    run(async () => {
      await reportIncident({ reservationId: incidentReservation, category: incidentCategory, description: incidentText.trim() });
      setIncidentText('');
      setIncidents(await listMyIncidents());
      return words.incidentSent;
    });
  }

  const canApply = role === 'traveler' && (!application || application.status === 'rejected');

  return (
    <>
      {role === 'traveler' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{words.becomeProvider}</Text>
          {application ? (
            <View style={styles.quote}>
              <Text style={styles.offerName}>{words.yourApplication}: {application.business_name} · {words.applicationStatus[application.status]}</Text>
              {application.review_note ? <Text style={styles.helper}>{application.review_note}</Text> : null}
              {application.status === 'approved' ? <Text style={styles.helper}>{words.approvedReload}</Text> : null}
            </View>
          ) : null}
          {canApply ? (
            <>
              <Text style={styles.helper}>{words.becomeProviderHint}</Text>
              <Field label={words.businessName} value={draft.businessName} onChange={businessName => setDraft({ ...draft, businessName })} maxLength={120} />
              <View style={styles.chips}>
                {CATEGORIES.map(item => (
                  <Chip key={item} label={portalWords.categories[item]} selected={category === item} onPress={() => setCategory(item)} />
                ))}
              </View>
              <Field label={words.contactName} value={draft.contactName} onChange={contactName => setDraft({ ...draft, contactName })} maxLength={120} />
              <Field label={words.contactPhone} value={draft.contactPhone} onChange={contactPhone => setDraft({ ...draft, contactPhone })} maxLength={20} />
              <Field label={words.contactEmail} value={draft.contactEmail} onChange={contactEmail => setDraft({ ...draft, contactEmail })} maxLength={200} />
              <Field label={words.businessLocation} value={draft.location} onChange={location => setDraft({ ...draft, location })} maxLength={160} />
              <Field label={words.businessDescription} value={draft.description} onChange={description => setDraft({ ...draft, description })} maxLength={2000} multiline />
              <ActionButton title={words.submitApplication} onPress={apply} disabled={busy || !draft.businessName.trim()} />
            </>
          ) : null}
        </View>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{words.incidentsTitle}</Text>
        <View style={styles.chips}>
          {INCIDENT_CATEGORIES.map(item => (
            <Chip key={item} label={words.incidentCategory[item]} selected={incidentCategory === item} onPress={() => setIncidentCategory(item)} />
          ))}
        </View>
        <Text style={styles.fieldLabel}>{words.incidentReservation}</Text>
        <View style={styles.chips}>
          <Chip label={words.noReservationLink} selected={incidentReservation === null} onPress={() => setIncidentReservation(null)} />
          {reservations.slice(0, 6).map(reservation => (
            <Chip
              key={reservation.id}
              label={`${reservation.service_date} · ${reservation.id.slice(0, 8)}`}
              selected={incidentReservation === reservation.id}
              onPress={() => setIncidentReservation(reservation.id)}
            />
          ))}
        </View>
        <Field label={words.incidentDescription} value={incidentText} onChange={setIncidentText} maxLength={2000} multiline />
        <ActionButton title={words.submitIncident} onPress={report} disabled={busy || incidentText.trim().length < 10} />
        {incidents.length ? (
          <>
            <Text style={styles.sectionTitle}>{words.myIncidents}</Text>
            {incidents.map(incident => (
              <View key={incident.id} style={styles.eventRow}>
                <Text style={styles.offerName}>{words.incidentCategory[incident.category]} · {words.incidentStatus[incident.status]}</Text>
                <Text style={styles.helper}>{incident.description}</Text>
                {incident.admin_note ? <Text style={styles.helper}>{incident.admin_note}</Text> : null}
              </View>
            ))}
          </>
        ) : null}
      </View>
    </>
  );
}
