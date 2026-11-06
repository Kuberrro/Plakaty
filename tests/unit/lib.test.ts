import { describe, expect, it } from 'vitest';
import { parseCsv, safeCell, toCsv } from '../../src/lib/csv';
import { distanceM, formatDistance, looksSwapped } from '../../src/lib/geo';
import { googleMapsUrl, navigationTarget } from '../../src/lib/navigation';
import { formatDateTime, fromWarsawInput, toWarsawInput, warsawDay } from '../../src/lib/time';
import { reportCsv } from '../../src/io/exports';
import type { Point, Visit } from '../../src/lib/types';

describe('CSV', () => {
  it('blokuje formuły', () => {
    for (const s of ['=1+1', '+48', '-2', '@x', '\tx', '\rx']) expect(safeCell(s).startsWith("'")).toBe(true);
    expect(safeCell('Ładna notatka')).toBe('Ładna notatka');
    expect(toCsv([['=HYPERLINK("http://x")']])).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
  it('polskie znaki, BOM, wieloliniowe notatki: zapis i odczyt', () => {
    const csv = toCsv([['nazwa', 'notatka'], ['Żółć; „ą”', 'pierwsza\nlinia "druga"']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const { header, rows } = parseCsv(csv);
    expect(header).toEqual(['nazwa', 'notatka']);
    expect(rows).toEqual([['Żółć; „ą”', 'pierwsza\nlinia "druga"']]);
  });
  it('rozpoznaje przecinek jako separator', () => expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']]));
  it('niezamknięty cudzysłów to błąd', () => expect(() => parseCsv('a\n"x')).toThrow());
  it('raport: notatka zabezpieczona, czas warszawski', () => {
    const visit = { visitedAt: '2026-07-01T10:05:00Z', outcome: 'posted', posterCount: 2, note: '=SUM(A1)' } as Visit;
    const csv = reportCsv({ visits: [{ visit, point: { name: 'Żabno', locality: '', address: null, region: null, lat: 50, lng: 20 } as Point }], uniquePlaces: 1, posters: 2, toReturn: [] });
    expect(csv).toContain('12:05');
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('Żabno');
  });
});

describe('czas Europe/Warsaw', () => {
  it('lato i zima', () => {
    expect(toWarsawInput('2026-07-01T10:00:00Z')).toBe('2026-07-01T12:00');
    expect(toWarsawInput('2026-01-01T10:00:00Z')).toBe('2026-01-01T11:00');
    expect(fromWarsawInput('2026-07-01T12:00')).toBe('2026-07-01T10:00:00.000Z');
    expect(fromWarsawInput('2026-01-01T11:00')).toBe('2026-01-01T10:00:00.000Z');
  });
  it('w dniu zmiany czasu', () => {
    expect(fromWarsawInput('2026-03-29T03:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(fromWarsawInput('2026-10-25T12:00')).toBe('2026-10-25T11:00:00.000Z');
  });
  it('dzień i format', () => {
    expect(warsawDay('2026-12-31T23:30:00Z')).toBe('2027-01-01');
    expect(formatDateTime('2026-07-01T10:00:00Z')).toContain('12:00');
  });
});

describe('geografia', () => {
  it('Kraków–Warszawa ok. 252 km w linii prostej', () => {
    const d = distanceM({ lat: 50.0614, lng: 19.9366 }, { lat: 52.2297, lng: 21.0122 });
    expect(d / 1000).toBeGreaterThan(250);
    expect(d / 1000).toBeLessThan(254);
  });
  it('podpis zawsze mówi „w linii prostej”', () => {
    expect(formatDistance(350)).toBe('350 m w linii prostej');
    expect(formatDistance(12340)).toBe('12,3 km w linii prostej');
  });
  it('wykrywa zamienione współrzędne w Polsce', () => {
    expect(looksSwapped(19.9, 50.1)).toBe(true);
    expect(looksSwapped(50.1, 19.9)).toBe(false);
  });
});

describe('Google Maps', () => {
  const base = { lat: 50.1, lng: 19.9, boardLat: null, boardLng: null } as Point;
  it('URL ze współrzędnymi i trybem jazdy, bez klucza', () => {
    const u = new URL(googleMapsUrl({ lat: 50.12345, lng: 19.98765 }));
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('destination')).toBe('50.12345,19.98765');
    expect(u.searchParams.get('travelmode')).toBe('driving');
    expect(u.search).not.toMatch(/key=/);
  });
  it('tablica ma pierwszeństwo przed obiektem', () => {
    expect(navigationTarget(base)).toEqual({ lat: 50.1, lng: 19.9, kind: 'object' });
    expect(navigationTarget({ ...base, boardLat: 50.2, boardLng: 19.8 })).toEqual({ lat: 50.2, lng: 19.8, kind: 'board' });
  });
});
