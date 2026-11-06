import type { Point, PointStatus, Visit } from './types';
import { warsawDay } from './time';

export interface Counters {
  /** Niezarchiwizowane punkty. */
  active: number;
  /** Aktywne punkty z co najmniej jedną nieanulowaną wizytą; wiele wizyt liczy się raz. */
  uniqueVisited: number;
  /** Aktualne statusy aktywnych punktów (wynik ostatniej wizyty). */
  todo: number;
  posted: number;
  return: number;
  impossible: number;
  /** Suma plakatów z nieanulowanych wizyt, także w punktach zarchiwizowanych. */
  postersTotal: number;
}

export function computeCounters(points: Point[], visits: Visit[], statuses: Map<string, PointStatus>): Counters {
  const live = visits.filter((v) => !v.cancelledAt);
  const activePoints = points.filter((p) => !p.archivedAt);
  const c: Counters = { active: activePoints.length, uniqueVisited: 0, todo: 0, posted: 0, return: 0, impossible: 0, postersTotal: 0 };
  for (const p of activePoints) c[statuses.get(p.id) ?? 'todo']++;
  const activeIds = new Set(activePoints.map((p) => p.id));
  c.uniqueVisited = new Set(live.filter((v) => activeIds.has(v.pointId)).map((v) => v.pointId)).size;
  c.postersTotal = live.reduce((s, v) => s + v.posterCount, 0);
  return c;
}

export const NO_REGION = '(bez rejonu)';

export interface RegionRow extends Counters { region: string }

export function countersByRegion(points: Point[], visits: Visit[], statuses: Map<string, PointStatus>): RegionRow[] {
  const groups = new Map<string, Point[]>();
  for (const p of points) {
    const key = p.region || NO_REGION;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([region, ps]) => {
      const ids = new Set(ps.map((p) => p.id));
      return { region, ...computeCounters(ps, visits.filter((v) => ids.has(v.pointId)), statuses) };
    })
    .filter((r) => r.active > 0)
    .sort((a, b) => a.region.localeCompare(b.region, 'pl'));
}

export interface ReportFilter { from: string | null; to: string | null; region: string | null }

export interface ReportResult {
  visits: { visit: Visit; point: Point | undefined }[];
  uniquePlaces: number;
  posters: number;
  toReturn: Point[];
}

const matchesRegion = (p: Point | undefined, region: string | null) =>
  !region || (region === NO_REGION ? !p?.region : p?.region === region);

/** Daty filtra to dni kalendarzowe w strefie Europe/Warsaw, obustronnie włącznie. */
export function buildReport(points: Point[], visits: Visit[], statuses: Map<string, PointStatus>, f: ReportFilter): ReportResult {
  const byId = new Map(points.map((p) => [p.id, p]));
  const rows = visits
    .filter((v) => !v.cancelledAt)
    .filter((v) => {
      const day = warsawDay(v.visitedAt);
      return (!f.from || day >= f.from) && (!f.to || day <= f.to) && matchesRegion(byId.get(v.pointId), f.region);
    })
    .sort((a, b) => Date.parse(a.visitedAt) - Date.parse(b.visitedAt))
    .map((visit) => ({ visit, point: byId.get(visit.pointId) }));
  return {
    visits: rows,
    uniquePlaces: new Set(rows.map((r) => r.visit.pointId)).size,
    posters: rows.reduce((s, r) => s + r.visit.posterCount, 0),
    toReturn: points
      .filter((p) => !p.archivedAt && statuses.get(p.id) === 'return' && matchesRegion(p, f.region))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
  };
}
