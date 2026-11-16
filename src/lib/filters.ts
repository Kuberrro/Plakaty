import { distanceM, type LatLng } from './geo';
import { navigationTarget } from './navigation';
import { NO_REGION } from './stats';
import type { PlaceType, Point, PointStatus } from './types';

export type ListScope = 'active' | 'archived' | 'trash';

export interface Filters {
  statuses: PointStatus[]; // puste = wszystkie
  placeTypes: PlaceType[]; // puste = wszystkie
  region: string | null;
  query: string;
  scope: ListScope;
}
export const EMPTY_FILTERS: Filters = { statuses: [], placeTypes: [], region: null, query: '', scope: 'active' };

const norm = (s: string) => s.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

export function inScope(p: Point, scope: ListScope): boolean {
  if (scope === 'trash') return !!p.deletedAt;
  if (p.deletedAt) return false;
  return scope === 'archived' ? !!p.archivedAt : !p.archivedAt;
}

export function applyFilters(points: Point[], statuses: Map<string, PointStatus>, f: Filters): Point[] {
  const q = norm(f.query.trim());
  return points.filter((p) =>
    inScope(p, f.scope)
    && (!f.statuses.length || f.statuses.includes(statuses.get(p.id) ?? 'todo'))
    && (!f.placeTypes.length || f.placeTypes.includes(p.placeType))
    && (!f.region || (f.region === NO_REGION ? !p.region : p.region === f.region))
    && (!q || norm(`${p.name} ${p.locality}`).includes(q)));
}

export function regionsOf(points: Point[]): string[] {
  return [...new Set(points.filter((p) => !p.deletedAt).map((p) => p.region).filter((r): r is string => !!r))]
    .sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Odległość w linii prostej do punktu, do którego prowadzi nawigacja. */
export const distanceTo = (from: LatLng, p: Point) => distanceM(from, navigationTarget(p));

/** Istniejące punkty blisko wskazanego miejsca (do ostrzeżeń o duplikatach). */
export function pointsNear(points: Point[], at: LatLng, maxM: number) {
  return points
    .filter((p) => !p.deletedAt && !p.archivedAt)
    .map((p) => ({ point: p, distance: distanceM(at, p) }))
    .filter((x) => x.distance <= maxM)
    .sort((a, b) => a.distance - b.distance);
}
