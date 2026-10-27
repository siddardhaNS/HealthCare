// Display helpers. The service runs in India: dates and dose times are IST.
const IST_MS = (5 * 60 + 30) * 60_000;

/** Today's date (YYYY-MM-DD) in IST. */
export const todayIST = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

/** "128/82", "97", "98.6": as the design writes each vital. */
export function vitalValue(type: string, value: number, value2: number | null): string {
  if (type === 'bp') return `${value}/${value2 ?? ''}`;
  if (type === 'temp' || type === 'weight') return value.toFixed(1);
  return String(value);
}

export function shortDateTime(iso: string, lng: string): string {
  return new Intl.DateTimeFormat(`${lng}-IN`, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

export function shortDate(isoDate: string, lng: string): string {
  return new Intl.DateTimeFormat(`${lng}-IN`, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** "21:00" → "9:00 PM" in the person's language. */
export function doseTime(hhmm: string, lng: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(`${lng}-IN`, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

export const initials = (name: string | null | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '·';
