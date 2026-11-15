import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, Chip, Field, formatBps, portalStyles as styles } from '../components/PortalControls';
import type { Language } from '../data/homeMock';
import { inputErrorText, portalCopy, type PortalCategory } from '../i18n/portalCopy';
import { platformCopy } from '../i18n/platformCopy';
import {
  getPlatformKpis,
  listAuditLog,
  listCampaigns,
  listIncidents,
  listMediaReviews,
  listOffersForModeration,
  listPlatformUsers,
  listProviderApplications,
  reviewProviderApplication,
  saveCampaign,
  setMediaModeration,
  setOfferModeration,
  updateIncident,
  type AdminIncident,
  type AuditEntry,
  type Campaign,
  type IncidentStatus,
  type MediaReview,
  type ModerationOffer,
  type PlatformKpis,
  type PlatformUser,
  type ProviderApplication,
} from '../lib/platformService';
import { sessionManager } from '../lib/insforge';
import { brlFromCents } from '../utils/format';
import { addDays, buziosIsoDate, parseIsoDate, parsePercentToBps } from '../utils/portalInput';

type Section = keyof (typeof platformCopy)['es']['sections'];
const SECTIONS: Section[] = ['applications', 'moderation', 'photos', 'incidents', 'users', 'kpis', 'audit', 'campaigns'];

// Error de validación ya traducido; el portal lo muestra tal cual.
class ConsoleInputError extends Error {}

export function AdminConsole({
  language,
  busy,
  run,
}: {
  language: Language;
  busy: boolean;
  run: (action: () => Promise<string | void>) => void;
}) {
  const words = platformCopy[language];
  const portalWords = portalCopy[language];
  const [section, setSection] = useState<Section | null>(null);
  const [applications, setApplications] = useState<ProviderApplication[]>([]);
  const [offers, setOffers] = useState<ModerationOffer[]>([]);
  const [photos, setPhotos] = useState<MediaReview[]>([]);
  // Las fotos pendientes solo se sirven con sesión de administración (función offer-media).
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [kpis, setKpis] = useState<PlatformKpis | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [note, setNote] = useState('');
  const [commission, setCommission] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [campaignDraft, setCampaignDraft] = useState({ title: '', body: '', starts: buziosIsoDate(), ends: addDays(buziosIsoDate(), 7) });

  function open(next: Section) {
    setSection(next);
    setSelectedId(null);
    setNote('');
    setCommission('');
    run(() => loadSection(next));
  }

  async function loadSection(next: Section) {
    if (next === 'applications') setApplications(await listProviderApplications('pending'));
    if (next === 'moderation') setOffers(await listOffersForModeration());
    if (next === 'photos') {
      setPhotos(await listMediaReviews('pending'));
      setPhotoToken((await sessionManager?.currentAccessToken()) ?? null);
    }
    if (next === 'incidents') setIncidents(await listIncidents(null));
    if (next === 'users') setUsers(await listPlatformUsers());
    if (next === 'kpis') {
      const today = buziosIsoDate();
      setKpis(await getPlatformKpis(addDays(today, -29), today));
    }
    if (next === 'audit') setAudit(await listAuditLog(50));
    if (next === 'campaigns') setCampaigns(await listCampaigns());
  }

  function review(application: ProviderApplication, decision: 'approved' | 'rejected') {
    run(async () => {
      let rate: number | null = null;
      if (decision === 'approved') {
        const parsed = parsePercentToBps(commission);
        if (!parsed.ok) throw new ConsoleInputError(inputErrorText(language, words.approvalCommission, parsed.error));
        if (parsed.value === null) throw new ConsoleInputError(portalWords.errors.invalid_commission_rate);
        rate = parsed.value;
      }
      await reviewProviderApplication({ applicationId: application.id, decision, note: note.trim(), commissionRateBps: rate });
      setSelectedId(null);
      await loadSection('applications');
      return words.reviewed;
    });
  }

  function moderate(offer: ModerationOffer, status: 'approved' | 'suspended') {
    run(async () => {
      await setOfferModeration(offer.offer_id, status, status === 'suspended' ? note.trim() : '');
      setSelectedId(null);
      await loadSection('moderation');
      return words.moderationSaved;
    });
  }

  function reviewPhoto(photo: MediaReview, status: 'approved' | 'rejected') {
    run(async () => {
      await setMediaModeration(photo.media_id, status, status === 'rejected' ? note.trim() : '');
      setSelectedId(null);
      setNote('');
      await loadSection('photos');
      return words.photoSaved;
    });
  }

  function triage(incident: AdminIncident, status: IncidentStatus) {
    run(async () => {
      await updateIncident(incident.id, status, note.trim());
      setSelectedId(null);
      await loadSection('incidents');
      return words.incidentSaved;
    });
  }

  function createCampaign() {
    run(async () => {
      const starts = parseIsoDate(campaignDraft.starts, '0000-01-01');
      const ends = parseIsoDate(campaignDraft.ends, '0000-01-01');
      if (!starts.ok) throw new ConsoleInputError(inputErrorText(language, words.campaignStarts, starts.error));
      if (!ends.ok) throw new ConsoleInputError(inputErrorText(language, words.campaignEnds, ends.error));
      await saveCampaign({
        id: null,
        title: campaignDraft.title.trim(),
        body: campaignDraft.body.trim(),
        category: null as PortalCategory | null,
        starts_on: starts.value,
        ends_on: ends.value,
        status: 'draft',
      });
      await loadSection('campaigns');
      return words.campaignSaved;
    });
  }

  function setCampaignStatus(campaign: Campaign, status: Campaign['status']) {
    run(async () => {
      await saveCampaign({ ...campaign, status });
      await loadSection('campaigns');
      return words.campaignSaved;
    });
  }

  const empty = <Text style={styles.helper}>{words.empty}</Text>;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{words.consoleTitle}</Text>
      <Text style={styles.helper}>{words.consoleHint}</Text>
      <View style={styles.chips}>
        {SECTIONS.map(item => (
          <Chip key={item} label={words.sections[item]} selected={section === item} onPress={() => open(item)} />
        ))}
      </View>

      {section === 'applications' ? (
        applications.length ? applications.map(application => (
          <View key={application.id} style={styles.eventRow}>
            <Text style={styles.offerName}>{application.business_name} · {portalWords.categories[application.category]}</Text>
            <Text style={styles.helper}>{application.contact_name} · {application.contact_phone} · {application.contact_email}</Text>
            <Text style={styles.helper}>{application.location}{application.description ? ` · ${application.description}` : ''}</Text>
            {selectedId === application.id ? (
              <View style={styles.quote}>
                <Field label={words.approvalCommission} value={commission} onChange={setCommission} decimal />
                <Text style={styles.helper}>{words.approvalHint}</Text>
                <Field label={words.reviewNote} value={note} onChange={setNote} maxLength={500} />
                <ActionButton title={words.approve} onPress={() => review(application, 'approved')} disabled={busy} />
                <ActionButton title={words.reject} onPress={() => review(application, 'rejected')} disabled={busy} secondary />
              </View>
            ) : (
              <Pressable onPress={() => setSelectedId(application.id)} accessibilityRole="button" accessibilityLabel={`${words.approve} / ${words.reject} ${application.business_name}`}>
                <Text style={styles.link}>{words.approve} / {words.reject}</Text>
              </Pressable>
            )}
          </View>
        )) : empty
      ) : null}

      {section === 'moderation' ? (
        offers.length ? offers.map(offer => (
          <View key={offer.offer_id} style={styles.eventRow}>
            <Text style={styles.offerName}>{offer.title} · {offer.provider_name}</Text>
            <Text style={offer.moderation_status === 'suspended' ? styles.warning : styles.helper}>
              {portalWords.categories[offer.category]} · {words.moderationStatus[offer.moderation_status]}
              {offer.moderation_note ? ` · ${offer.moderation_note}` : ''}
            </Text>
            {offer.moderation_status !== 'approved' ? (
              <Pressable onPress={() => moderate(offer, 'approved')} disabled={busy} accessibilityRole="button" accessibilityLabel={`${words.restore} ${offer.title}`}>
                <Text style={styles.link}>{words.restore}</Text>
              </Pressable>
            ) : selectedId === offer.offer_id ? (
              <View style={styles.quote}>
                <Field label={words.moderationNote} value={note} onChange={setNote} maxLength={500} />
                <ActionButton title={words.suspend} onPress={() => moderate(offer, 'suspended')} disabled={busy} />
              </View>
            ) : (
              <Pressable onPress={() => setSelectedId(offer.offer_id)} accessibilityRole="button" accessibilityLabel={`${words.suspend} ${offer.title}`}>
                <Text style={styles.link}>{words.suspend}</Text>
              </Pressable>
            )}
          </View>
        )) : empty
      ) : null}

      {section === 'photos' ? (
        <>
          <Text style={styles.helper}>{words.photoQueueHint}</Text>
          {photos.length ? photos.map(photo => (
            <View key={photo.media_id} style={styles.eventRow}>
              <Image
                source={{ uri: photo.url, headers: photoToken ? { Authorization: `Bearer ${photoToken}` } : undefined }}
                accessible
                accessibilityLabel={photo.alt_text}
                resizeMode="contain"
                style={[photoStyles.review, { aspectRatio: photo.width / photo.height }]}
              />
              <Text style={styles.offerName}>{words.photoOffer}: {photo.offer_title} · {photo.provider_name}</Text>
              <Text style={styles.helper}>{photo.alt_text} · {photo.width}×{photo.height} · {photo.created_at.slice(0, 16).replace('T', ' ')}</Text>
              {selectedId === photo.media_id ? (
                <View style={styles.quote}>
                  <Field label={words.photoRejectReason} value={note} onChange={setNote} maxLength={300} />
                  <ActionButton title={words.photoReject} onPress={() => reviewPhoto(photo, 'rejected')} disabled={busy || note.trim().length < 3} />
                </View>
              ) : (
                <View style={styles.chips}>
                  <ActionButton title={words.photoApprove} onPress={() => reviewPhoto(photo, 'approved')} disabled={busy} />
                  <ActionButton title={words.photoReject} onPress={() => { setSelectedId(photo.media_id); setNote(''); }} disabled={busy} secondary />
                </View>
              )}
            </View>
          )) : empty}
        </>
      ) : null}

      {section === 'incidents' ? (
        incidents.length ? incidents.map(incident => (
          <View key={incident.id} style={styles.eventRow}>
            <Text style={styles.offerName}>{words.incidentCategory[incident.category]} · {words.incidentStatus[incident.status]} · {incident.reporter_name}</Text>
            <Text style={styles.helper}>{incident.description}</Text>
            {incident.admin_note ? <Text style={styles.helper}>{incident.admin_note}</Text> : null}
            {selectedId === incident.id ? (
              <View style={styles.quote}>
                <Field label={words.incidentNote} value={note} onChange={setNote} maxLength={1000} />
                <ActionButton title={words.markInProgress} onPress={() => triage(incident, 'in_progress')} disabled={busy} secondary />
                <ActionButton title={words.markResolved} onPress={() => triage(incident, 'resolved')} disabled={busy} />
              </View>
            ) : incident.status !== 'resolved' ? (
              <Pressable onPress={() => setSelectedId(incident.id)} accessibilityRole="button" accessibilityLabel={`${words.markResolved} ${incident.id}`}>
                <Text style={styles.link}>{words.markResolved}</Text>
              </Pressable>
            ) : null}
          </View>
        )) : empty
      ) : null}

      {section === 'users' ? (
        <>
          <Text style={styles.helper}>{words.usersHint}</Text>
          {users.length ? users.map(user => (
            <View key={user.user_id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.offerName}>{user.display_name} · {portalWords.roles[user.role]}</Text>
                <Text style={styles.helper}>{user.email ?? '—'} · {user.country_code}</Text>
              </View>
            </View>
          )) : empty}
        </>
      ) : null}

      {section === 'kpis' && kpis ? (
        <View style={styles.quote}>
          <Text style={styles.helper}>{words.kpiPeriod}</Text>
          <Text style={styles.helper}>{words.kpiQuotes}: {kpis.quotes} · {words.kpiReservations}: {kpis.reservations}</Text>
          <Text style={styles.helper}>{words.kpiConfirmed}: {kpis.confirmed} · {words.kpiCancelled}: {kpis.cancelled} · {words.kpiExpired}: {kpis.expired}</Text>
          <Text style={styles.helper}>{words.kpiConversion}: {formatBps(kpis.quote_to_confirmed_bps)}</Text>
          <Text style={styles.helper}>{words.kpiGross}: {brlFromCents(kpis.confirmed_gross_cents)}</Text>
          <Text style={styles.helper}>{words.kpiFee}: {brlFromCents(kpis.service_fee_cents)} · {words.kpiCommission}: {brlFromCents(kpis.commission_cents)}</Text>
          <Text style={styles.helper}>{words.kpiRefunded}: {brlFromCents(kpis.refunded_cents)}</Text>
        </View>
      ) : null}

      {section === 'audit' ? (
        audit.length ? audit.map(entry => (
          <View key={entry.id} style={styles.eventRow}>
            <Text style={styles.offerName}>{entry.action} · {entry.target_table.replace('connectical_', '')}</Text>
            <Text selectable style={styles.helper}>{entry.created_at} · {entry.actor_user_id ?? words.auditSystem} · {entry.target_id}</Text>
          </View>
        )) : empty
      ) : null}

      {section === 'campaigns' ? (
        <>
          <Text style={styles.helper}>{words.campaignHint}</Text>
          {campaigns.map(campaign => (
            <View key={campaign.id} style={styles.eventRow}>
              <Text style={styles.offerName}>{campaign.title} · {words.campaignStatus[campaign.status]}</Text>
              <Text style={styles.helper}>{campaign.starts_on} → {campaign.ends_on}{campaign.body ? ` · ${campaign.body}` : ''}</Text>
              {campaign.status !== 'archived' ? (
                <Pressable
                  onPress={() => setCampaignStatus(campaign, campaign.status === 'draft' ? 'active' : 'archived')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${campaign.status === 'draft' ? words.campaignActivate : words.campaignArchive} ${campaign.title}`}
                >
                  <Text style={styles.link}>{campaign.status === 'draft' ? words.campaignActivate : words.campaignArchive}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <View style={styles.quote}>
            <Field label={words.campaignTitle} value={campaignDraft.title} onChange={title => setCampaignDraft({ ...campaignDraft, title })} maxLength={80} />
            <Field label={words.campaignBody} value={campaignDraft.body} onChange={body => setCampaignDraft({ ...campaignDraft, body })} maxLength={500} />
            <Field label={words.campaignStarts} value={campaignDraft.starts} onChange={starts => setCampaignDraft({ ...campaignDraft, starts })} />
            <Field label={words.campaignEnds} value={campaignDraft.ends} onChange={ends => setCampaignDraft({ ...campaignDraft, ends })} />
            <ActionButton title={words.campaignSave} onPress={createCampaign} disabled={busy} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const photoStyles = StyleSheet.create({ review: { width: '100%', maxHeight: 260 } });

export { ConsoleInputError };
