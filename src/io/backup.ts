import { distanceM, validLat, validLng } from '../lib/geo';
import { newId } from '../lib/ids';
import type { ConflictCopy, Outcome, Point, Visit } from '../lib/types';
import { sameContent } from '../sync/mapping';
import type { Snapshot } from '../data/repository';

export const BACKUP_FORMAT = 'plakaty-kopia';
export const BACKUP_VERSION = 1;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

type BackupPoint = Omit<Point, 'ownerId' | 'serverRev'>;
type BackupVisit = Omit<Visit, 'ownerId' | 'serverRev'>;

export interface Backup {
  format: string;
  version: number;
  exportedAt: string;
  /** Kopia z trybu demonstracyjnego: nie wolno jej przywrócić do prawdziwych danych. */
  demo?: boolean;
  regions: string[];
  points: BackupPoint[];
  visits: BackupVisit[];
}

/** Pełna kopia: bez właściciela i wersji serwera, bo te zależą od konta, a nie od danych. */
export function createBackup(s: Pick<Snapshot, 'points' | 'visits'>, now = new Date(), demo = false): Backup {
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), ...(demo ? { demo } : {}),
    regions: [...new Set(s.points.map((p) => p.region).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, 'pl')),
    points: s.points.map(({ ownerId: _o, serverRev: _s, ...p }) => p),
    visits: s.visits.map(({ ownerId: _o, serverRev: _s, ...v }) => v),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isIso = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const isStr = (x: unknown) => typeof x === 'string';
const orNull = (x: unknown, f: (y: unknown) => boolean) => x === null || x === undefined || f(x);

function pointErrors(p: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (!UUID.test(String(p.id))) e.push('niepoprawne id');
  if (!isStr(p.name) || !String(p.name).trim()) e.push('brak nazwy');
  if (!['fire_station', 'notice_board', 'other'].includes(p.placeType as string)) e.push('nieznany typ miejsca');
  if (!['osm', 'manual', 'import'].includes(p.source as string)) e.push('nieznane źródło');
  if (!validLat(p.lat as number) || !validLng(p.lng as number)) e.push('niepoprawne współrzędne');
  if ((p.boardLat == null) !== (p.boardLng == null)) e.push('niepełne współrzędne tablicy');
  if (p.boardLat != null && (!validLat(p.boardLat as number) || !validLng(p.boardLng as number))) e.push('niepoprawne współrzędne tablicy');
  if (!isIso(p.createdAt) || !isIso(p.updatedAt)) e.push('niepoprawne daty');
  if (!orNull(p.archivedAt, isIso)) e.push('niepoprawna data archiwizacji');
  for (const k of ['locality', 'note']) if (!orNull(p[k], isStr)) e.push(`niepoprawne pole ${k}`);
  return e;
}

function visitErrors(v: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (!UUID.test(String(v.id))) e.push('niepoprawne id');
  if (!UUID.test(String(v.pointId))) e.push('niepoprawne id punktu');
  if (!['posted', 'return', 'impossible'].includes(v.outcome as Outcome)) e.push('nieznany wynik');
  if (!Number.isInteger(v.posterCount) || (v.posterCount as number) < 0 || (v.posterCount as number) > 1000) e.push('niepoprawna liczba plakatów');
  if (!isIso(v.visitedAt) || !isIso(v.createdAt) || !isIso(v.updatedAt)) e.push('niepoprawne daty');
  if (!orNull(v.cancelledAt, isIso)) e.push('niepoprawna data anulowania');
  if (v.corrections !== undefined && !Array.isArray(v.corrections)) e.push('niepoprawna historia korekt');
  if (v.gps != null) {
    const g = v.gps as Record<string, unknown>;
    if (!validLat(g.lat as number) || !validLng(g.lng as number) || !isIso(g.measuredAt)) e.push('niepoprawny pomiar GPS');
  }
  return e;
}

export interface ParsedBackup { demo: boolean; exportedAt: string; points: BackupPoint[]; visits: BackupVisit[] }

/** Walidacja bez dotykania bazy. Rzuca listę błędów: niepoprawny plik niczego nie zmienia. */
export function parseBackup(text: string): ParsedBackup {
  let data: Backup;
  try { data = JSON.parse(text); } catch { throw new ImportError(['To nie jest poprawny plik JSON.']); }
  if (!data || data.format !== BACKUP_FORMAT) throw new ImportError(['To nie jest kopia danych aplikacji Plakaty.']);
  if (data.version !== BACKUP_VERSION) throw new ImportError([`Nieobsługiwana wersja kopii: ${data.version}.`]);
  if (!Array.isArray(data.points) || !Array.isArray(data.visits)) throw new ImportError(['W kopii brakuje listy punktów lub wizyt.']);
  const errors: string[] = [];
  data.points.forEach((p, i) => pointErrors(p as never).forEach((e) => errors.push(`Punkt ${i + 1}: ${e}`)));
  data.visits.forEach((v, i) => visitErrors(v as never).forEach((e) => errors.push(`Wizyta ${i + 1}: ${e}`)));
  if (errors.length) throw new ImportError(errors);
  return { demo: data.demo === true, exportedAt: String(data.exportedAt), points: data.points, visits: data.visits };
}

export class ImportError extends Error {
  constructor(readonly errors: string[]) { super(errors.slice(0, 3).join(' ')); }
}

const POINT_DEFAULTS: Partial<Point> = {
  address: null, region: null, boardLat: null, boardLng: null, sourceRef: null, osm: null,
  archivedAt: null, archiveReason: null, locality: '', note: '',
};
const VISIT_DEFAULTS: Partial<Visit> = { cancelledAt: null, cancelReason: null, gps: null, corrections: [], note: '' };

export interface ImportPlan {
  newPoints: Point[];
  newVisits: Visit[];
  identical: number;
  conflicts: ConflictCopy[];
  orphanVisits: number;
}

/**
 * Zasady: nic nie jest kasowane ani nadpisywane. Nowe rekordy są dodawane jako dane
 * BIEŻĄCEGO konta (właściciel z pliku jest pomijany). Rekord o tym samym id:
 * identyczny = pominięty; inny = zostaje obecny, wersja z pliku trafia do „Konfliktów”.
 * Ten sam obiekt OSM pod innym id: zostaje obecny punkt, a wizyty są do niego dopinane.
 */
export function planImport(file: ParsedBackup, current: Pick<Snapshot, 'points' | 'visits' | 'conflicts'>, ownerId: string): ImportPlan {
  const points = new Map(current.points.map((p) => [p.id, p]));
  const visits = new Map(current.visits.map((v) => [v.id, v]));
  const bySource = new Map(current.points.filter((p) => p.sourceRef).map((p) => [`${p.source}|${p.sourceRef}`, p.id]));
  const plan: ImportPlan = { newPoints: [], newVisits: [], identical: 0, conflicts: [], orphanVisits: 0 };
  const remap = new Map<string, string>();
  const at = new Date().toISOString();

  const addConflict = (entity: ConflictCopy['entity'], version: Point | Visit) => {
    const seen = current.conflicts.some((c) => c.entityId === version.id && c.origin === 'import' && sameContent(c.version, version));
    if (!seen) plan.conflicts.push({ id: newId(), entity, entityId: version.id, at, origin: 'import', version });
  };

  for (const raw of file.points) {
    const p = { ...POINT_DEFAULTS, ...raw, ownerId, serverRev: null } as Point;
    const existing = points.get(p.id);
    if (existing) {
      if (sameContent(existing, p)) plan.identical++;
      else addConflict('point', p);
      continue;
    }
    const sameSource = p.sourceRef ? bySource.get(`${p.source}|${p.sourceRef}`) : undefined;
    if (sameSource) { remap.set(p.id, sameSource); plan.identical++; continue; }
    if (p.sourceRef) bySource.set(`${p.source}|${p.sourceRef}`, p.id);
    points.set(p.id, p);
    plan.newPoints.push(p);
  }
  for (const raw of file.visits) {
    const pointId = remap.get(raw.pointId) ?? raw.pointId;
    const v = { ...VISIT_DEFAULTS, ...raw, pointId, ownerId, serverRev: null } as Visit;
    if (!points.has(pointId)) { plan.orphanVisits++; continue; }
    const existing = visits.get(v.id);
    if (existing) {
      if (sameContent(existing, v)) plan.identical++;
      else addConflict('visit', v);
      continue;
    }
    plan.newVisits.push(v);
  }
  return plan;
}

/** Punkt o tej samej nazwie w tym samym miejscu to prawdopodobny duplikat importu. */
export const isSameSpot = (a: { name: string; lat: number; lng: number }, b: { name: string; lat: number; lng: number }) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && distanceM(a, b) < 10;
