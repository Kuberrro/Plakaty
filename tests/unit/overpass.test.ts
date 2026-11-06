import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildQuery, candidateState, candidateToPoint, OverpassError, parseElements, possibleDuplicates, searchFireStations, type RawElement,
} from '../../src/osm/overpass';
import { addVisit, updatePoint } from '../../src/data/actions';
import { freshIdb, repoFor } from './helpers';
import type { Point } from '../../src/lib/types';

afterEach(() => vi.unstubAllGlobals());
const t = '2026-11-06T10:00:00.000Z';
const elements: RawElement[] = [
  { type: 'node', id: 1, lat: 50.1, lon: 19.9, tags: { amenity: 'fire_station', name: 'OSP Testowo', 'addr:city': 'Testowo', 'addr:street': 'Polna', 'addr:housenumber': '5' } },
  { type: 'way', id: 2, center: { lat: 50.2, lon: 19.8 }, tags: { amenity: 'fire_station' } },
  { type: 'relation', id: 3, center: { lat: 50.3, lon: 19.7 }, tags: {} },
  { type: 'way', id: 4 }, // bez środka
];

describe('zapytanie i wyniki', () => {
  it('node, way, relation z tagiem amenity=fire_station', () => {
    const q = buildQuery(50.06, 19.93, 25);
    expect(q).toContain('nwr["amenity"="fire_station"](around:25000,50.06000,19.93000)');
    expect(q).toContain('out center tags');
  });
  it('zachowuje typ, ID, tagi i datę; bez nazwy uczciwy opis', () => {
    const c = parseElements(elements, t);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ ref: 'node/1', name: 'OSP Testowo', locality: 'Testowo', address: 'Polna 5', hasName: true });
    expect(c[0].osm).toMatchObject({ type: 'node', id: 1, fetchedAt: t, representative: false });
    expect(c[1].name).toBe('Obiekt bez nazwy w OSM (way/2)');
    expect(c[1].osm.representative).toBe(true);
    expect(c[1].locality).toBe(''); // nie wymyślamy
    expect(c[1].address).toBeNull();
  });
  it('stabilny UUID dla tego samego obiektu', () => {
    expect(parseElements(elements, t)[0].id).toBe(parseElements(elements, 'inna data')[0].id);
    expect(parseElements(elements, t)[0].id).not.toBe(parseElements(elements, t)[1].id);
  });
});

describe('odporność', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  it('jedna próba na serwer, potem koniec', async () => {
    const f = vi.fn(async () => new Response('', { status: 502 }));
    vi.stubGlobal('fetch', f);
    await expect(searchFireStations({ lat: 50, lng: 20 }, 10, { endpoints: ['http://a', 'http://b'], online: true })).rejects.toMatchObject({ kind: 'server' });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('przechodzi na serwer zapasowy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => (u === 'http://a' ? new Response('', { status: 429 }) : ok({ elements }))));
    const r = await searchFireStations({ lat: 50, lng: 20 }, 10, { endpoints: ['http://a', 'http://b'], online: true });
    expect(r.endpoint).toBe('http://b');
    expect(r.candidates).toHaveLength(3);
  });
  it('rozróżnia limit zapytań', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(searchFireStations({ lat: 50, lng: 20 }, 10, { endpoints: ['http://a'], online: true })).rejects.toMatchObject({ kind: 'rate-limit' });
  });
  it('HTTP 200 z uwagą o przerwaniu to błąd, nie niepełny wynik', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ elements: [elements[0]], remark: 'runtime error: Query timed out in "query"' })));
    await expect(searchFireStations({ lat: 50, lng: 20 }, 10, { endpoints: ['http://a'], online: true })).rejects.toBeInstanceOf(OverpassError);
  });
  it('offline: bez żadnego żądania', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(searchFireStations({ lat: 50, lng: 20 }, 10, { online: false })).rejects.toMatchObject({ kind: 'offline' });
    expect(f).not.toHaveBeenCalled();
  });
  it('promień poza limitem odrzucany', async () => {
    await expect(searchFireStations({ lat: 50, lng: 20 }, 500, { online: true })).rejects.toThrow();
  });
  it('niepoprawny JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(searchFireStations({ lat: 50, lng: 20 }, 10, { endpoints: ['http://a'], online: true })).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('deduplikacja', () => {
  it('pobliski obiekt oznaczony, nie scalony', () => {
    const [a] = parseElements(elements, t);
    expect(possibleDuplicates(a, [{ id: 'x', name: 'Obok', lat: 50.1003, lng: 19.9 }])).toHaveLength(1);
    expect(possibleDuplicates(a, [{ id: 'x', name: 'Daleko', lat: 50.2, lng: 19.9 }])).toHaveLength(0);
  });
  it('ponowne wyszukiwanie nie rusza istniejącego punktu, wizyt ani korekt', async () => {
    freshIdb();
    const repo = await repoFor();
    const [c] = parseElements(elements, t);
    await repo.commit({ points: [candidateToPoint(c, repo.ownerId, 'Rejon A')] });
    await updatePoint(repo, repo.getPoint(c.id)!, { name: 'Moja korekta', boardLat: 50.11, boardLng: 19.91, note: 'notatka' });
    await addVisit(repo, { pointId: c.id, visitedAt: t, outcome: 'posted', posterCount: 2, note: '', gps: null });

    const again = parseElements(elements, '2027-01-01T00:00:00.000Z');
    expect(candidateState(again[0], repo.getSnapshot().points)).toBe('in-base');
    const fresh = again.filter((x) => candidateState(x, repo.getSnapshot().points) === 'new');
    expect(fresh.map((x) => x.ref)).toEqual(['way/2', 'relation/3']);
    await repo.commit({ points: fresh.map((x) => candidateToPoint(x, repo.ownerId, null)) });

    const p = repo.getPoint(c.id) as Point;
    expect(p).toMatchObject({ name: 'Moja korekta', boardLat: 50.11, note: 'notatka', region: 'Rejon A' });
    expect(repo.getSnapshot().statuses.get(c.id)).toBe('posted');
    expect(repo.getSnapshot().visits).toHaveLength(1);
    expect(repo.getSnapshot().points).toHaveLength(3);
  });
});
