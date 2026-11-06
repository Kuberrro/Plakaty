import { distanceM, type LatLng } from './geo';
import { navigationTarget } from './navigation';
import { NO_REGION } from './stats';
import type { Point, PointStatus } from './types';

export interface Filters {
  statuses: PointStatus[]; // puste = wszystkie
  region: string | null;
  query: string;
  archived: boolean;
}
export const EMPTY_FILTERS: Filters = { statuses: [], region: null, query: '', archived: false };

const norm = (s: string) => s.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

export function applyFilters(points: Point[], statuses: Map<string, PointStatus>, f: Filters): Point[] {
  const q = norm(f.query.trim());
  return points.filter((p) =>
    (f.archived ? !!p.archivedAt : !p.archivedAt)
    && (!f.statuses.length || f.statuses.includes(statuses.get(p.id) ?? 'todo'))
    && (!f.region || (f.region === NO_REGION ? !p.region : p.region === f.region))
    && (!q || norm(`${p.name} ${p.locality}`).includes(q)));
}

export function regionsOf(points: Point[]): string[] {
  return [...new Set(points.map((p) => p.region).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Odległość w linii prostej do punktu, do którego prowadzi nawigacja. */
export const distanceTo = (from: LatLng, p: Point) => distanceM(from, navigationTarget(p));
