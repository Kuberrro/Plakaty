import { newId } from '../lib/ids';
import { navigationTarget } from '../lib/navigation';
import type { ActiveTarget, Outcome, PlaceType, Point, Visit, VisitGps } from '../lib/types';
import type { Repository } from './repository';

const now = () => new Date().toISOString();

export type PointDraft = Pick<Point,
  'name' | 'placeType' | 'locality' | 'address' | 'region' | 'lat' | 'lng' | 'boardLat' | 'boardLng' | 'note'>;

export async function createManualPoint(repo: Repository, d: PointDraft): Promise<Point> {
  const t = now();
  const p: Point = {
    ...d, id: newId(), ownerId: repo.ownerId, source: 'manual', sourceRef: null, osm: null,
    createdAt: t, updatedAt: t, archivedAt: null, archiveReason: null, deletedAt: null, serverRev: null,
  };
  await repo.commit({ points: [p] });
  return p;
}

export async function updatePoint(repo: Repository, p: Point, patch: Partial<PointDraft>): Promise<void> {
  await repo.commit({ points: [{ ...p, ...patch, updatedAt: now() }] });
}

export async function archivePoint(repo: Repository, p: Point, reason: string | null): Promise<void> {
  const t = now();
  await repo.commit({ points: [{ ...p, archivedAt: t, archiveReason: reason, updatedAt: t }] });
}

export async function restorePoint(repo: Repository, p: Point): Promise<void> {
  await repo.commit({ points: [{ ...p, archivedAt: null, archiveReason: null, updatedAt: now() }] });
}

export interface VisitDraft {
  pointId: string; visitedAt: string; outcome: Outcome; posterCount: number; note: string; gps: VisitGps | null;
}

export const defaultPosters = (o: Outcome) => (o === 'posted' ? 1 : 0);

function checkDraft(d: { posterCount: number }) {
  if (!Number.isInteger(d.posterCount) || d.posterCount < 0 || d.posterCount > 1000) {
    throw new Error('Liczba plakatów musi być liczbą całkowitą od 0 do 1000');
  }
}

/** Zapis wizyty kończy aktywny dojazd tylko wtedy, gdy dotyczy tego samego punktu. */
export async function addVisit(repo: Repository, d: VisitDraft): Promise<Visit> {
  checkDraft(d);
  const t = now();
  const v: Visit = {
    ...d, id: newId(), ownerId: repo.ownerId, createdAt: t, updatedAt: t,
    cancelledAt: null, cancelReason: null, corrections: [], serverRev: null,
  };
  const active = repo.getSnapshot().activeTarget;
  await repo.commit({ visits: [v], ...(active?.pointId === d.pointId ? { activeTarget: null } : {}) });
  return v;
}

/** Korekta zachowuje poprzednie wartości w historii wpisu. */
export async function correctVisit(
  repo: Repository, v: Visit, patch: Pick<Visit, 'visitedAt' | 'outcome' | 'posterCount' | 'note'>,
): Promise<void> {
  checkDraft(patch);
  const t = now();
  const before = { visitedAt: v.visitedAt, outcome: v.outcome, posterCount: v.posterCount, note: v.note };
  await repo.commit({ visits: [{ ...v, ...patch, updatedAt: t, corrections: [...v.corrections, { at: t, before }] }] });
}

export async function cancelVisit(repo: Repository, v: Visit, reason: string | null): Promise<void> {
  const t = now();
  await repo.commit({ visits: [{ ...v, cancelledAt: t, cancelReason: reason, updatedAt: t }] });
}

export async function restoreVisit(repo: Repository, v: Visit): Promise<void> {
  await repo.commit({ visits: [{ ...v, cancelledAt: null, cancelReason: null, updatedAt: now() }] });
}

/** Krok 1 nawigacji: trwały zapis celu. Nie tworzy wizyty; zastępuje poprzedni cel. */
export async function startNavigation(repo: Repository, p: Point): Promise<ActiveTarget> {
  const target: ActiveTarget = { pointId: p.id, startedAt: now(), ...navigationTarget(p) };
  await repo.commit({ activeTarget: target });
  return target;
}

export async function cancelNavigation(repo: Repository): Promise<void> {
  await repo.commit({ activeTarget: null });
}

/** Kosz: punkt znika z mapy, listy, raportów i eksportów, ale nic nie jest kasowane. */
export async function trashPoints(repo: Repository, points: Point[]): Promise<void> {
  const t = now();
  const ids = new Set(points.map((p) => p.id));
  const active = repo.getSnapshot().activeTarget;
  await repo.commit({
    points: points.map((p) => ({ ...p, deletedAt: t, updatedAt: t })),
    ...(active && ids.has(active.pointId) ? { activeTarget: null } : {}),
  });
}

export async function untrashPoints(repo: Repository, points: Point[]): Promise<void> {
  const t = now();
  await repo.commit({ points: points.map((p) => ({ ...p, deletedAt: null, updatedAt: t })) });
}

export async function unarchivePoints(repo: Repository, points: Point[]): Promise<void> {
  const t = now();
  await repo.commit({ points: points.map((p) => ({ ...p, archivedAt: null, archiveReason: null, updatedAt: t })) });
}

export async function bulkUpdatePoints(
  repo: Repository, points: Point[], patch: Partial<Pick<Point, 'region' | 'placeType'>>,
): Promise<void> {
  const t = now();
  await repo.commit({ points: points.map((p) => ({ ...p, ...patch, updatedAt: t })) });
}

export interface QuickAddDraft {
  name: string; placeType: PlaceType; region: string | null; lat: number; lng: number;
  outcome: Outcome; posterCount: number; note: string; gps: VisitGps | null;
}

/** Nowy punkt i wizyta w JEDNEJ transakcji: albo zapisze się oba, albo nic. */
export async function quickAdd(repo: Repository, d: QuickAddDraft): Promise<{ point: Point; visit: Visit }> {
  checkDraft(d);
  if (!d.name.trim()) throw new Error('Brak nazwy punktu');
  const t = now();
  const point: Point = {
    id: newId(), ownerId: repo.ownerId, name: d.name.trim().slice(0, 200), placeType: d.placeType, locality: '', address: null,
    region: d.region?.trim() || null, lat: d.lat, lng: d.lng, boardLat: null, boardLng: null, source: 'manual', sourceRef: null,
    osm: null, note: '', createdAt: t, updatedAt: t, archivedAt: null, archiveReason: null, deletedAt: null, serverRev: null,
  };
  const visit: Visit = {
    id: newId(), ownerId: repo.ownerId, pointId: point.id, visitedAt: t, outcome: d.outcome, posterCount: d.posterCount,
    note: d.note.trim(), createdAt: t, updatedAt: t, cancelledAt: null, cancelReason: null, gps: d.gps, corrections: [], serverRev: null,
  };
  await repo.commit({ points: [point], visits: [visit] });
  return { point, visit };
}
