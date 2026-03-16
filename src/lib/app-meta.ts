export const APP_LAST_CHANGE_AT = '2026-03-16T12:30:00+01:00';

export function formatLastChangeForPl(rawIso: string) {
  const parsed = new Date(rawIso);
  if (Number.isNaN(parsed.getTime())) {
    return rawIso;
  }

  return parsed.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}