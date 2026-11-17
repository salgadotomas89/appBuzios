import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../data/homeMock';
import { portalCopy } from '../i18n/portalCopy';
import type { ProfileLanguage, ProviderProfile, updateOwnProviderProfile } from '../lib/platformService';
import { ActionButton, Chip, Field, portalStyles as styles } from './PortalControls';

const LANGUAGES: ProfileLanguage[] = ['pt', 'es', 'en'];

// Perfil comercial que los turistas ven en las ofertas. El servidor valida longitudes e idiomas.
export function ProviderProfileForm({
  language,
  load,
  save,
  run,
  busy,
}: {
  language: Language;
  load: () => Promise<ProviderProfile | null>;
  save: (input: Parameters<typeof updateOwnProviderProfile>[0]) => Promise<ProviderProfile | null>;
  run: (action: () => Promise<string | void>) => void;
  busy: boolean;
}) {
  const words = portalCopy[language].profile;
  const [description, setDescription] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [languages, setLanguages] = useState<ProfileLanguage[]>([]);
  const [name, setName] = useState('');
  const loadRef = useRef(load);

  useEffect(() => {
    let active = true;
    // Un tenant sin la migración no tiene perfil: el formulario queda vacío.
    loadRef.current().then(profile => {
      if (!active || !profile) return;
      setName(profile.name);
      setDescription(profile.public_description);
      setNeighborhood(profile.neighborhood);
      setLanguages(profile.languages);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function toggle(code: ProfileLanguage) {
    setLanguages(current => (current.includes(code) ? current.filter(item => item !== code) : [...current, code]));
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{words.title}{name ? ` · ${name}` : ''}</Text>
      <Text style={styles.helper}>{words.hint}</Text>
      <Field label={words.description} value={description} onChange={setDescription} maxLength={500} multiline />
      <Field label={words.neighborhood} value={neighborhood} onChange={setNeighborhood} maxLength={80} />
      <Text style={styles.fieldLabel}>{words.languages}</Text>
      <View style={styles.chips}>
        {LANGUAGES.map(code => (
          <Chip key={code} label={words.languageNames[code]} selected={languages.includes(code)} onPress={() => toggle(code)} />
        ))}
      </View>
      <ActionButton
        title={words.save}
        disabled={busy}
        onPress={() =>
          run(async () => {
            await save({ description: description.trim(), neighborhood: neighborhood.trim(), languages });
            return words.saved;
          })
        }
      />
    </View>
  );
}
