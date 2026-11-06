import { describe, expect, it } from 'vitest';
import { statusFromVisits, statusMap } from '../../src/lib/status';
import { buildReport, computeCounters, countersByRegion } from '../../src/lib/stats';
import type { Outcome, Point, Visit } from '../../src/lib/types';

const v = (id: string, pointId: string, visitedAt: string, outcome: Outcome, posterCount = 0, extra: Partial<Visit> = {}): Visit => ({
  id, ownerId: 'u', pointId, visitedAt, outcome, posterCount, note: '', createdAt: visitedAt, updatedAt: visitedAt,
  cancelledAt: null, cancelReason: null, gps: null, corrections: [], serverRev: null, ...extra,
});
const p = (id: string, region: string | null = null, archivedAt: string | null = null) =>
  ({ id, name: id, region, archivedAt, lat: 50, lng: 20 }) as Point;

describe('reguła statusu', () => {
  it('bez wizyt: do odwiedzenia', () => expect(statusFromVisits([])).toBe('todo'));
  it('decyduje najnowsza wizyta, nie kolejność zapisu', () => {
    expect(statusFromVisits([v('b', 'p', '2026-05-02T10:00:00Z', 'return'), v('a', 'p', '2026-05-01T10:00:00Z', 'posted')])).toBe('return');
    expect(statusFromVisits([v('a', 'p', '2026-05-01T10:00:00Z', 'posted'), v('b', 'p', '2026-05-02T10:00:00Z', 'return')])).toBe('return');
  });
  it('anulowana wizyta nie liczy się, status wraca do poprzedniej', () => {
    expect(statusFromVisits([
      v('a', 'p', '2026-05-01T10:00:00Z', 'return'),
      v('b', 'p', '2026-05-02T10:00:00Z', 'posted', 1, { cancelledAt: '2026-05-02T11:00:00Z' }),
    ])).toBe('return');
  });
  it('anulowanie jedynej wizyty przywraca „do odwiedzenia”', () => {
    expect(statusFromVisits([v('a', 'p', '2026-05-01T10:00:00Z', 'posted', 1, { cancelledAt: '2026-05-02T11:00:00Z' })])).toBe('todo');
  });
  it('ten sam czas: rozstrzyga później utworzona', () => {
    const t = '2026-05-01T10:00:00Z';
    expect(statusFromVisits([
      v('a', 'p', t, 'posted', 1, { createdAt: '2026-05-01T12:00:00Z' }),
      v('b', 'p', t, 'return', 0, { createdAt: '2026-05-01T11:00:00Z' }),
    ])).toBe('posted');
  });
});

describe('liczniki i raporty', () => {
  const points = [p('A', 'Północ'), p('B', 'Południe'), p('C'), p('X', 'Północ', '2026-04-01T00:00:00Z')];
  const visits = [
    v('1', 'A', '2026-05-01T08:00:00Z', 'posted', 2),
    v('2', 'A', '2026-05-01T09:00:00Z', 'posted', 3), // druga wizyta tego samego miejsca
    v('3', 'B', '2026-05-01T09:30:00Z', 'return'),
    v('4', 'C', '2026-05-01T10:00:00Z', 'posted', 5, { cancelledAt: '2026-05-01T11:00:00Z' }),
    v('5', 'X', '2026-05-01T10:00:00Z', 'posted', 4), // punkt zarchiwizowany
  ];
  const statuses = statusMap(points.map((x) => x.id), visits);

  it('nie mieszają wizyt, unikalnych miejsc i plakatów', () => {
    expect(computeCounters(points, visits, statuses)).toEqual({
      active: 3, uniqueVisited: 2, todo: 1, posted: 1, return: 1, impossible: 0, postersTotal: 9,
    });
  });
  it('rozbicie na rejony', () => {
    const r = countersByRegion(points, visits, statuses);
    expect(r.map((x) => [x.region, x.active, x.uniqueVisited])).toEqual([['(bez rejonu)', 1, 0], ['Południe', 1, 1], ['Północ', 1, 1]]);
  });
  it('raport pomija anulowane i liczy miejsce raz', () => {
    const r = buildReport(points, visits, statuses, { from: '2026-05-01', to: '2026-05-01', region: 'Północ' });
    expect(r.visits.map((x) => x.visit.id)).toEqual(['1', '2', '5']);
    expect(r.uniquePlaces).toBe(2);
    expect(r.posters).toBe(9);
  });
  it('granica doby wg Warszawy, nie UTC', () => {
    const late = [v('n', 'A', '2026-05-01T22:30:00Z', 'posted', 1)]; // 00:30 2 maja w Warszawie
    expect(buildReport(points, late, statuses, { from: '2026-05-02', to: '2026-05-02', region: null }).visits).toHaveLength(1);
    expect(buildReport(points, late, statuses, { from: '2026-05-01', to: '2026-05-01', region: null }).visits).toHaveLength(0);
  });
  it('lista powrotów wg aktualnego statusu', () => {
    expect(buildReport(points, visits, statuses, { from: null, to: null, region: null }).toReturn.map((x) => x.id)).toEqual(['B']);
  });
});
