import type { PointStatus, Visit } from './types';

/**
 * JEDYNA reguła statusu w aplikacji (ta sama w widoku SQL public.point_status):
 * status punktu = wynik najnowszej NIEANULOWANEJ wizyty, wg czasu wizyty
 * (przy remisie: późniejsze utworzenie, potem id). Brak takich wizyt = „do odwiedzenia”.
 * Dlatego korekta i anulowanie same poprawiają status oraz raporty.
 */
export function compareVisitsNewestFirst(a: Visit, b: Visit): number {
  return (
    Date.parse(b.visitedAt) - Date.parse(a.visitedAt) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

export function statusFromVisits(visits: Visit[]): PointStatus {
  const active = visits.filter((v) => !v.cancelledAt);
  if (!active.length) return 'todo';
  return [...active].sort(compareVisitsNewestFirst)[0].outcome;
}

export function statusMap(pointIds: Iterable<string>, visits: Iterable<Visit>): Map<string, PointStatus> {
  const byPoint = new Map<string, Visit[]>();
  for (const v of visits) {
    const list = byPoint.get(v.pointId);
    if (list) list.push(v);
    else byPoint.set(v.pointId, [v]);
  }
  const out = new Map<string, PointStatus>();
  for (const id of pointIds) out.set(id, statusFromVisits(byPoint.get(id) ?? []));
  return out;
}
