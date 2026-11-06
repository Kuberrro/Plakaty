export const TZ = 'Europe/Warsaw';

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dtFmt = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Dzień kalendarzowy w Warszawie jako YYYY-MM-DD (porównywalny jak tekst). */
export const warsawDay = (iso: string | number | Date): string => dayFmt.format(new Date(iso));
export const formatDateTime = (iso: string): string => dtFmt.format(new Date(iso));

function wallParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Wartość pola datetime-local: czas ściany w Warszawie. */
export function toWarsawInput(iso: string): string {
  const p = wallParts(new Date(iso));
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** Odwrotność toWarsawInput, poprawna także przy zmianie czasu. */
export function fromWarsawInput(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) throw new Error('Niepoprawna data');
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = wallParts(new Date(guess));
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diff = wall - shown;
    if (!diff) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}
