import { useEffect, useState } from 'react';
import { buziosIsoDate } from '../utils/portalInput';

// Fecha de hoy en Búzios que se actualiza sola: si la app queda abierta al pasar la medianoche,
// las fechas mínimas y el bloqueo de fechas pasadas usan el día nuevo sin reiniciar.
export function useBuziosToday(checkEveryMs = 60_000): string {
  const [today, setToday] = useState(() => buziosIsoDate());
  useEffect(() => {
    const timer = setInterval(() => {
      const next = buziosIsoDate();
      setToday(current => (current === next ? current : next));
    }, checkEveryMs);
    return () => clearInterval(timer);
  }, [checkEveryMs]);
  return today;
}
