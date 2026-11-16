import { beforeEach, describe, expect, it } from 'vitest';
import {
  addVisit, bulkUpdatePoints, quickAdd, startNavigation, trashPoints, untrashPoints, type QuickAddDraft,
} from '../../src/data/actions';
import { createBackup, parseBackup, planImport } from '../../src/io/backup';
import { myMapsCsv, pointsForSharing, pointsGeoJson } from '../../src/io/exports';
import { parsePointsCsv } from '../../src/io/importPoints';
import { applyFilters, EMPTY_FILTERS } from '../../src/lib/filters';
import { buildReport, computeCounters, countersByRegion } from '../../src/lib/stats';
import type { Point } from '../../src/lib/types';
import { SCHEMA_OUTDATED, supabaseBackend } from '../../src/sync/backend';
import { SyncEngine } from '../../src/sync/engine';
import { pointToRow, sameContent } from '../../src/sync/mapping';
import { createClient } from '@supabase/supabase-js';
import { FakeServer, freshIdb, point, repoFor, USER } from './helpers';

beforeEach(freshIdb);
const T = '2026-05-01T10:00:00.000Z';
const visitAt = (pointId: string) => ({ pointId, visitedAt: T, outcome: 'posted' as const, posterCount: 2, note: '', gps: null });

/** Punkt dokładnie tak, jak zapisywała go wersja 1.0 (bez pola deletedAt). */
function legacyPoint(over: Partial<Point> = {}): Omit<Point, 'deletedAt'> {
  return {
    id: '5f8a1d64-1111-4111-8111-111111111111', ownerId: USER, name: 'Stary punkt', placeType: 'fire_station', locality: 'X', address: null,
    region: 'Północ', lat: 50.1, lng: 19.9, boardLat: null, boardLng: null, source: 'manual', sourceRef: null, osm: null, note: 'n',
    createdAt: T, updatedAt: T, archivedAt: null, archiveReason: null, serverRev: 1, ...over,
  };
}

describe('aktualizacja z wersji 1.0: istniejące dane', () => {
  it('punkty bez pola deletedAt wczytują się jako aktywne, nic nie trafia do kolejki', async () => {
    let repo = await repoFor();
    await repo.db.put('points', legacyPoint() as Point);
    repo.db.close();
    repo = await repoFor();
    const p = repo.getSnapshot().points[0];
    expect(p.deletedAt).toBeNull();
    expect(repo.pendingOps()).toHaveLength(0);
    expect(computeCounters(repo.getSnapshot().points, [], repo.getSnapshot().statuses).active).toBe(1);
    expect(applyFilters(repo.getSnapshot().points, repo.getSnapshot().statuses, EMPTY_FILTERS)).toHaveLength(1);
  });
  it('stary rekord i ten sam rekord z chmury to nie konflikt', () => {
    const old = legacyPoint() as Point;
    expect(sameContent(old, { ...old, deletedAt: null })).toBe(true);
    expect(sameContent(old, { ...old, deletedAt: T })).toBe(false);
  });
  it('synchronizacja starych danych z bazą już po aktualizacji: bez konfliktów i zmian', async () => {
    const server = new FakeServer();
    let repo = await repoFor();
    const p = await point(repo, { name: 'Sprzed aktualizacji' });
    await addVisit(repo, visitAt(p.id));
    await new SyncEngine(repo, server).sync();
    // wiersze w chmurze dostają nową kolumnę jako pustą (jak po uruchomieniu SQL 0002)
    for (const r of server.tables.points.values()) r.deleted_at = null;
    repo.db.close();
    repo = await repoFor();
    await new SyncEngine(repo, server).sync();
    expect(repo.getSnapshot().conflicts).toHaveLength(0);
    expect(repo.pendingOps()).toHaveLength(0);
    expect(repo.getSnapshot().statuses.get(p.id)).toBe('posted');
  });
  it('kopia JSON z wersji 1.0 wczytuje się, identyczne rekordy nie są dublowane', async () => {
    const repo = await repoFor();
    await repo.db.put('points', legacyPoint() as Point);
    await repo.load();
    const old = createBackup(repo.getSnapshot()) as unknown as { points: Record<string, unknown>[] };
    old.points.forEach((x) => delete x.deletedAt); // plik z wersji 1.0 nie miał tego pola
    const plan = planImport(parseBackup(JSON.stringify(old)), repo.getSnapshot(), USER);
    expect(plan).toMatchObject({ newPoints: [], identical: 1, conflicts: [] });
    freshIdb();
    const other = await repoFor();
    const plan2 = planImport(parseBackup(JSON.stringify(old)), other.getSnapshot(), USER);
    expect(plan2.newPoints[0].deletedAt).toBeNull();
  });
  it('baza w chmurze bez aktualizacji: zmiany zostają w kolejce z czytelnym komunikatem', async () => {
    const client = createClient('https://x.supabase.co', 'sb_publishable_test', {
      auth: { persistSession: false },
      global: { fetch: (async () => new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'deleted_at' column of 'points' in the schema cache" }), { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch },
    });
    const repo = await repoFor();
    await point(repo);
    const engine = new SyncEngine(repo, { ...supabaseBackend(client), currentUserId: async () => USER });
    await engine.sync();
    expect(repo.pendingOps()).toHaveLength(1);
    expect(repo.pendingOps()[0].lastError).toBe(SCHEMA_OUTDATED);
    expect(repo.getSnapshot().points).toHaveLength(1);
  });
  it('wysyłany wiersz zawiera deleted_at także dla starych rekordów', () => {
    expect(pointToRow(legacyPoint() as Point, USER, 'op').deleted_at).toBeNull();
  });
});

describe('kosz', () => {
  it('punkt w koszu znika z liczników, raportów, eksportów i filtra; historia zostaje', async () => {
    const repo = await repoFor();
    const keep = await point(repo, { name: 'Zostaje', region: 'A' });
    const gone = await point(repo, { name: 'Do kosza', region: 'B' });
    await addVisit(repo, visitAt(keep.id));
    await addVisit(repo, visitAt(gone.id));
    await trashPoints(repo, [repo.getPoint(gone.id)!]);
    const s = repo.getSnapshot();
    expect(computeCounters(s.points, s.visits, s.statuses)).toMatchObject({ active: 1, uniqueVisited: 1, postersTotal: 2, posted: 1 });
    expect(countersByRegion(s.points, s.visits, s.statuses).map((r) => r.region)).toEqual(['A']);
    expect(buildReport(s.points, s.visits, s.statuses, { from: null, to: null, region: null }).visits).toHaveLength(1);
    expect(JSON.parse(pointsGeoJson(s.points, s.statuses)).features).toHaveLength(1);
    expect(pointsForSharing(s.points, s.statuses, { statuses: ['posted'], region: null, includeArchived: true }).map((p) => p.name)).toEqual(['Zostaje']);
    expect(applyFilters(s.points, s.statuses, EMPTY_FILTERS).map((p) => p.name)).toEqual(['Zostaje']);
    expect(applyFilters(s.points, s.statuses, { ...EMPTY_FILTERS, scope: 'trash' }).map((p) => p.name)).toEqual(['Do kosza']);
    expect(s.visits).toHaveLength(2);
    expect(createBackup(s).points).toHaveLength(2); // pełna kopia zawiera też kosz
  });
  it('przywrócenie z kosza przywraca liczniki', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await addVisit(repo, visitAt(p.id));
    await trashPoints(repo, [repo.getPoint(p.id)!]);
    await untrashPoints(repo, [repo.getPoint(p.id)!]);
    const s = repo.getSnapshot();
    expect(computeCounters(s.points, s.visits, s.statuses)).toMatchObject({ active: 1, postersTotal: 2 });
  });
  it('usunięcie aktywnego celu kończy dojazd bez wizyty', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await startNavigation(repo, p);
    await trashPoints(repo, [p]);
    expect(repo.getSnapshot().activeTarget).toBeNull();
    expect(repo.getSnapshot().visits).toHaveLength(0);
  });
  it('usunięcie wielu punktów to jedna transakcja i synchronizuje się jak zwykła zmiana', async () => {
    const server = new FakeServer();
    const repo = await repoFor();
    const a = await point(repo, { name: 'A' });
    const b = await point(repo, { name: 'B' });
    const engine = new SyncEngine(repo, server);
    await engine.sync();
    await trashPoints(repo, [repo.getPoint(a.id)!, repo.getPoint(b.id)!]);
    await engine.sync();
    expect(server.points().every((p) => p.deletedAt)).toBe(true);
    freshIdb();
    const other = await repoFor();
    await new SyncEngine(other, server).sync();
    expect(applyFilters(other.getSnapshot().points, other.getSnapshot().statuses, EMPTY_FILTERS)).toHaveLength(0);
  });
  it('masowa zmiana rejonu i rodzaju', async () => {
    const repo = await repoFor();
    const a = await point(repo); const b = await point(repo);
    await bulkUpdatePoints(repo, [repo.getPoint(a.id)!, repo.getPoint(b.id)!], { region: 'Nowy', placeType: 'bus_stop' });
    expect(repo.getSnapshot().points.map((p) => [p.region, p.placeType])).toEqual([['Nowy', 'bus_stop'], ['Nowy', 'bus_stop']]);
  });
});

describe('szybkie dodanie', () => {
  const draft = (over: Partial<QuickAddDraft> = {}): QuickAddDraft => ({
    name: 'Przystanek · 16.11', placeType: 'bus_stop', region: 'Północ', lat: 50.2, lng: 19.95, outcome: 'posted', posterCount: 2, note: '',
    gps: { lat: 50.2, lng: 19.95, accuracyM: 8, measuredAt: T }, ...over,
  });
  it('tworzy punkt i wizytę naraz; status i liczniki od razu', async () => {
    const repo = await repoFor();
    const { point: p, visit } = await quickAdd(repo, draft());
    const s = repo.getSnapshot();
    expect(p).toMatchObject({ placeType: 'bus_stop', region: 'Północ', source: 'manual', deletedAt: null });
    expect(visit).toMatchObject({ pointId: p.id, posterCount: 2, gps: { accuracyM: 8 } });
    expect(s.statuses.get(p.id)).toBe('posted');
    expect(computeCounters(s.points, s.visits, s.statuses)).toMatchObject({ active: 1, uniqueVisited: 1, postersTotal: 2 });
    expect(repo.pendingOps().map((o) => o.entity)).toEqual(['point', 'visit']);
  });
  it('błąd zapisu nie zostawia samego punktu bez wizyty', async () => {
    const repo = await repoFor();
    await expect(quickAdd(repo, draft({ posterCount: -5 }))).rejects.toThrow();
    await expect(quickAdd(repo, draft({ name: '  ' }))).rejects.toThrow();
    expect(repo.getSnapshot().points).toHaveLength(0);
    expect(repo.getSnapshot().visits).toHaveLength(0);
  });
});

describe('Google Moje Mapy', () => {
  it('CSV z przecinkiem, bez BOM, pozycja tablicy, notatki tylko na życzenie', async () => {
    const repo = await repoFor();
    const a = await point(repo, { name: 'Tablica, Rynek', boardLat: 50.5, boardLng: 19.5, note: 'prywatne' });
    await point(repo, { name: 'Nieodwiedzony' });
    await addVisit(repo, visitAt(a.id));
    const s = repo.getSnapshot();
    const list = pointsForSharing(s.points, s.statuses, { statuses: ['posted'], region: null, includeArchived: false });
    const csv = myMapsCsv(list, s.visits, s.statuses, false);
    const lines = csv.trim().split('\r\n');
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(lines[0]).toBe('Nazwa,Latitude,Longitude,Status,Rodzaj,Miejscowość,Adres,Rejon,Plakaty,Ostatnia wizyta');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"Tablica, Rynek",50.5,19.5,Plakat powieszony,Inne miejsce,Testowo,,Północ,2,2026-05-01');
    expect(csv).not.toContain('prywatne');
    expect(myMapsCsv(list, s.visits, s.statuses, true)).toContain('prywatne');
  });
  it('filtr statusu, rejonu i archiwum', async () => {
    const repo = await repoFor();
    const a = await point(repo, { region: 'A' });
    const b = await point(repo, { region: 'B' });
    await addVisit(repo, visitAt(a.id));
    await addVisit(repo, visitAt(b.id));
    await repo.commit({ points: [{ ...repo.getPoint(b.id)!, archivedAt: T }] });
    const s = repo.getSnapshot();
    expect(pointsForSharing(s.points, s.statuses, { statuses: ['posted'], region: null, includeArchived: false })).toHaveLength(1);
    expect(pointsForSharing(s.points, s.statuses, { statuses: ['posted'], region: null, includeArchived: true })).toHaveLength(2);
    expect(pointsForSharing(s.points, s.statuses, { statuses: ['posted'], region: 'B', includeArchived: true })).toHaveLength(1);
    expect(pointsForSharing(s.points, s.statuses, { statuses: ['todo'], region: null, includeArchived: true })).toHaveLength(0);
  });
});

describe('import z nowymi rodzajami', () => {
  it('rozpoznaje polskie nazwy rodzajów', () => {
    const r = parsePointsCsv('nazwa;typ;lat;lng\nA;przystanek;50;20\nB;Skrzyżowanie;50;20.1\nC;przy drodze;50;20.2\nD;świetlica;50;20.3\nE;Tablica ogłoszeń;50;20.4\n');
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.placeType)).toEqual(['bus_stop', 'crossroads', 'roadside', 'community', 'notice_board']);
  });
});
