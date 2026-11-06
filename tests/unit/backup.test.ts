import { beforeEach, describe, expect, it } from 'vitest';
import { addVisit, cancelVisit, correctVisit } from '../../src/data/actions';
import { createBackup, ImportError, parseBackup, planImport } from '../../src/io/backup';
import { parsePointsCsv, parsePointsGeoJson, planPointsImport } from '../../src/io/importPoints';
import { pointsGeoJson } from '../../src/io/exports';
import { candidateToPoint, parseElements } from '../../src/osm/overpass';
import { freshIdb, OTHER, point, repoFor, USER } from './helpers';

beforeEach(freshIdb);

async function seeded() {
  const repo = await repoFor(USER);
  const a = await point(repo, { name: 'Ałtajska', boardLat: 50.2, boardLng: 19.8, note: 'notatka' });
  const b = await point(repo, { name: 'Bracka' });
  const v1 = await addVisit(repo, { pointId: a.id, visitedAt: '2026-05-01T10:00:00.000Z', outcome: 'posted', posterCount: 3, note: 'n', gps: { lat: 50, lng: 20, accuracyM: 7, measuredAt: '2026-05-01T10:00:00.000Z' } });
  await correctVisit(repo, v1, { visitedAt: v1.visitedAt, outcome: 'posted', posterCount: 4, note: 'poprawione' });
  const v2 = await addVisit(repo, { pointId: b.id, visitedAt: '2026-05-02T10:00:00.000Z', outcome: 'return', posterCount: 0, note: '', gps: null });
  await cancelVisit(repo, v2, 'pomyłka');
  return repo;
}

describe('pełna kopia JSON', () => {
  it('eksport i import odtwarzają punkty i historię na innym koncie', async () => {
    const src = await seeded();
    const text = JSON.stringify(createBackup(src.getSnapshot()));
    expect(text).not.toContain(USER);

    const dst = await repoFor(OTHER);
    const plan = planImport(parseBackup(text), dst.getSnapshot(), OTHER);
    await dst.commit({ points: plan.newPoints, visits: plan.newVisits, conflicts: plan.conflicts });

    const s = dst.getSnapshot();
    expect(s.points.every((p) => p.ownerId === OTHER)).toBe(true);
    expect(s.visits.every((v) => v.ownerId === OTHER)).toBe(true);
    const strip = (r: { ownerId: string; serverRev: number | null }) => ({ ...r, ownerId: 0, serverRev: 0 });
    expect(s.points.map(strip)).toEqual(src.getSnapshot().points.map(strip));
    expect(s.visits.map(strip)).toEqual(src.getSnapshot().visits.map(strip));
    expect(dst.pendingOps()).toHaveLength(4);
    expect([...s.statuses.values()].sort()).toEqual([...src.getSnapshot().statuses.values()].sort());
  });
  it('identyfikator właściciela z pliku jest ignorowany', async () => {
    const src = await seeded();
    const b = createBackup(src.getSnapshot()) as unknown as { points: Record<string, unknown>[]; visits: Record<string, unknown>[] };
    b.points.forEach((p) => { p.ownerId = 'hacker'; p.serverRev = 999; });
    b.visits.forEach((v) => { v.ownerId = 'hacker'; });
    const dst = await repoFor(OTHER);
    const plan = planImport(parseBackup(JSON.stringify(b)), dst.getSnapshot(), OTHER);
    expect(plan.newPoints.every((p) => p.ownerId === OTHER && p.serverRev === null)).toBe(true);
    expect(plan.newVisits.every((v) => v.ownerId === OTHER)).toBe(true);
  });
  it('ponowny import niczego nie dubluje', async () => {
    const repo = await seeded();
    const plan = planImport(parseBackup(JSON.stringify(createBackup(repo.getSnapshot()))), repo.getSnapshot(), USER);
    expect(plan).toMatchObject({ newPoints: [], newVisits: [], identical: 4, conflicts: [] });
  });
  it('różniący się rekord: zostaje obecny, wersja z pliku do konfliktów', async () => {
    const repo = await seeded();
    const b = createBackup(repo.getSnapshot());
    b.points[0].name = 'Inna nazwa';
    const plan = planImport(parseBackup(JSON.stringify(b)), repo.getSnapshot(), USER);
    expect(plan.newPoints).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    await repo.commit({ conflicts: plan.conflicts });
    expect(repo.getSnapshot().points[0].name).toBe('Ałtajska');
    const second = planImport(parseBackup(JSON.stringify(b)), repo.getSnapshot(), USER);
    expect(second.conflicts).toHaveLength(0);
  });
  it('ten sam obiekt OSM pod innym id: wizyty dopięte do obecnego punktu', async () => {
    const repo = await repoFor(USER);
    const [c] = parseElements([{ type: 'node', id: 7, lat: 50, lon: 20, tags: { name: 'X' } }], '2026-01-01T00:00:00.000Z');
    await repo.commit({ points: [candidateToPoint(c, USER, null)] });
    const file = createBackup(repo.getSnapshot());
    const oldId = '33333333-3333-4333-8333-333333333333';
    file.points[0].id = oldId;
    file.visits = [{ id: '44444444-4444-4444-8444-444444444444', pointId: oldId, visitedAt: '2026-01-01T00:00:00.000Z', outcome: 'posted', posterCount: 1, note: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', cancelledAt: null, cancelReason: null, gps: null, corrections: [] }];
    const plan = planImport(parseBackup(JSON.stringify(file)), repo.getSnapshot(), USER);
    expect(plan.newPoints).toEqual([]);
    expect(plan.newVisits[0].pointId).toBe(c.id);
  });
  it('wizyta bez punktu nie jest importowana', async () => {
    const repo = await seeded();
    const b = createBackup(repo.getSnapshot());
    b.points = [];
    const dst = await repoFor(OTHER);
    const plan = planImport(parseBackup(JSON.stringify(b)), dst.getSnapshot(), OTHER);
    expect(plan).toMatchObject({ newVisits: [], orphanVisits: 2 });
  });
  it.each([
    ['nie JSON', '{{{'],
    ['inny format', '{"format":"x"}'],
    ['zła wersja', '{"format":"plakaty-kopia","version":99,"points":[],"visits":[]}'],
    ['brak list', '{"format":"plakaty-kopia","version":1}'],
  ])('błędny plik odrzucony: %s', (_n, text) => {
    expect(() => parseBackup(text)).toThrow(ImportError);
  });
  it('jeden zepsuty rekord odrzuca cały plik, baza bez zmian', async () => {
    const repo = await seeded();
    const before = JSON.stringify(repo.getSnapshot().points);
    const b = createBackup(repo.getSnapshot());
    b.points[0].lat = 123;
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/współrzędne/);
    expect(JSON.stringify(repo.getSnapshot().points)).toBe(before);
    expect(repo.getSnapshot().points).toHaveLength(2);
  });
});

describe('import punktów', () => {
  const csv = 'nazwa;typ;miejscowosc;adres;rejon;lat;lng;tablica_lat;tablica_lng;notatka;id_zrodlowe\n'
    + 'Tablica Rynek;tablica;Skawina;;Południe;49,975;19,828;;;;T-1\nRemiza;remiza;Zabierzów;Polna 1;;50.11;19.79;50.111;19.791;"z ""cudzysłowem""";\n';
  it('CSV: średnik, przecinek dziesiętny, tablica', () => {
    const r = parsePointsCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: 'Tablica Rynek', placeType: 'notice_board', lat: 49.975, lng: 19.828, region: 'Południe', sourceRef: 'T-1' });
    expect(r.rows[1]).toMatchObject({ boardLat: 50.111, note: 'z "cudzysłowem"' });
  });
  it('CSV: brak kolumn', () => expect(parsePointsCsv('a;b\n1;2').errors[0]).toContain('nazwa'));
  it('CSV: błędne wiersze raportowane, dobre zostają', () => {
    const r = parsePointsCsv('nazwa;lat;lng\n;50;20\nBad;abc;20\nFar;95;20\nOK;50;20\n');
    expect(r.rows.map((x) => x.name)).toEqual(['OK']);
    expect(r.errors).toHaveLength(3);
  });
  it('zamienione lat/lng: wykrycie i świadoma zamiana', () => {
    const text = 'nazwa;lat;lng\nX;19.9;50.1\n';
    expect(parsePointsCsv(text)).toMatchObject({ rows: [], swapped: 1 });
    expect(parsePointsCsv(text, true).rows[0]).toMatchObject({ lat: 50.1, lng: 19.9 });
  });
  it('GeoJSON: kolejność [lng, lat]', () => {
    const r = parsePointsGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [19.9, 50.1] }, properties: { nazwa: 'A' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2]] }, properties: { nazwa: 'L' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [50.1, 19.9] }, properties: { nazwa: 'S' } },
    ] }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ lat: 50.1, lng: 19.9 });
    expect(r.swapped).toBe(1);
    expect(r.errors).toHaveLength(2);
  });
  it('GeoJSON: niepoprawny plik', () => {
    expect(parsePointsGeoJson('nie').errors).toHaveLength(1);
    expect(parsePointsGeoJson('{"type":"Point"}').errors).toHaveLength(1);
  });
  it('duplikaty pomijane, także przy ponownym imporcie', async () => {
    const repo = await repoFor(USER);
    const first = planPointsImport(parsePointsCsv(csv).rows, repo.getSnapshot().points, USER);
    expect(first.create).toHaveLength(2);
    await repo.commit({ points: first.create });
    const second = planPointsImport(parsePointsCsv(csv).rows, repo.getSnapshot().points, USER);
    expect(second).toMatchObject({ create: [], duplicates: 2 });
  });
  it('eksport GeoJSON można zaimportować z powrotem', async () => {
    const repo = await seeded();
    const s = repo.getSnapshot();
    const r = parsePointsGeoJson(pointsGeoJson(s.points, s.statuses));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });
});
