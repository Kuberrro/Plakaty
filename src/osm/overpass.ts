import { distanceM } from '../lib/geo';
import { idForSourceRef } from '../lib/ids';
import { PLACE_LABEL, type OsmMeta, type PlaceType, type Point } from '../lib/types';

export const KRAKOW = { lat: 50.0614, lng: 19.9366 };
export const DEFAULT_RADIUS_KM = 15;
export const MAX_RADIUS_KM = 50;
export const MIN_RADIUS_KM = 1;
export const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
export const NEARBY_DUPLICATE_M = 100;
/** Powyżej tej liczby wynik jest ucinany: telefon i Overpass mają swoje granice. */
export const MAX_RESULTS = 1500;

/** Kategorie miejsc, przy których często są tablice. Dane OSM bywają niepełne. */
export type SearchCategory = 'notice_board' | 'fire_station' | 'community' | 'church' | 'shop' | 'bus_stop';

export const CATEGORIES: Record<SearchCategory, { label: string; selectors: string[]; maxRadiusKm: number; hint?: string }> = {
  notice_board: {
    label: 'Tablice i słupy ogłoszeniowe',
    selectors: ['nwr["amenity"="notice_board"]', 'nwr["advertising"~"^(column|board)$"]'],
    maxRadiusKm: MAX_RADIUS_KM,
    hint: 'W OSM wokół Krakowa tablic jest bardzo mało; słupy są głównie w mieście.',
  },
  fire_station: { label: 'Remizy', selectors: ['nwr["amenity"="fire_station"]'], maxRadiusKm: MAX_RADIUS_KM },
  community: { label: 'Świetlice i urzędy', selectors: ['nwr["amenity"~"^(community_centre|townhall)$"]'], maxRadiusKm: MAX_RADIUS_KM },
  church: { label: 'Kościoły i kaplice', selectors: ['nwr["amenity"="place_of_worship"]'], maxRadiusKm: MAX_RADIUS_KM },
  shop: {
    label: 'Sklepy spożywcze', selectors: ['nwr["shop"~"^(convenience|supermarket|general)$"]'], maxRadiusKm: 10,
    hint: 'Bardzo dużo wyników: najwyżej 10 km.',
  },
  bus_stop: {
    label: 'Przystanki', selectors: ['node["highway"="bus_stop"]'], maxRadiusKm: 5,
    hint: 'Bardzo dużo wyników: najwyżej 5 km.',
  },
};
export const ALL_CATEGORIES = Object.keys(CATEGORIES) as SearchCategory[];
export const DEFAULT_CATEGORIES: SearchCategory[] = ['notice_board', 'community', 'fire_station'];

/** Jedno kliknięcie = najwyżej jedna próba na serwer, potem koniec. Bez pętli ponawiania. */
export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://ovp.dresel.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const REQUEST_TIMEOUT_MS = 40_000;

export interface Candidate {
  ref: string; // "way/123"
  id: string;
  osm: OsmMeta;
  category: SearchCategory;
  name: string;
  hasName: boolean;
  locality: string;
  address: string | null;
  lat: number;
  lng: number;
}

export type OverpassErrorKind = 'offline' | 'timeout' | 'rate-limit' | 'server' | 'invalid';

export class OverpassError extends Error {
  constructor(readonly kind: OverpassErrorKind, message: string) { super(message); }
}

/** Największy dozwolony promień dla wybranych kategorii. */
export const radiusLimit = (cats: SearchCategory[]) =>
  Math.min(MAX_RADIUS_KM, ...cats.map((c) => CATEGORIES[c].maxRadiusKm));

export function buildQuery(lat: number, lng: number, radiusKm: number, cats: SearchCategory[]): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const parts = cats.flatMap((c) => CATEGORIES[c].selectors).map((s) => `${s}${around};`).join('');
  return `[out:json][timeout:35];(${parts});out center tags ${MAX_RESULTS};`;
}

export interface RawElement {
  type: OsmMeta['type']; id: number; lat?: number; lon?: number;
  center?: { lat: number; lon: number }; tags?: Record<string, string>;
}

export function categoryOf(tags: Record<string, string>): SearchCategory {
  if (tags.amenity === 'fire_station') return 'fire_station';
  if (tags.amenity === 'notice_board' || tags.advertising === 'column' || tags.advertising === 'board') return 'notice_board';
  if (tags.amenity === 'community_centre' || tags.amenity === 'townhall') return 'community';
  if (tags.amenity === 'place_of_worship') return 'church';
  if (tags.shop) return 'shop';
  if (tags.highway === 'bus_stop') return 'bus_stop';
  return 'fire_station'; // starsze zapytania dotyczyły tylko remiz
}

const PLACE_FOR: Record<SearchCategory, PlaceType> = {
  notice_board: 'notice_board', fire_station: 'fire_station', community: 'community', church: 'church', shop: 'shop', bus_stop: 'bus_stop',
};

function unnamedLabel(tags: Record<string, string>, cat: SearchCategory): string {
  if (tags.advertising === 'column') return 'Słup ogłoszeniowy';
  return PLACE_LABEL[PLACE_FOR[cat]];
}

export function parseElements(elements: RawElement[], fetchedAt: string): Candidate[] {
  const out: Candidate[] = [];
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (lat == null || lng == null) continue;
    const tags = e.tags ?? {};
    const ref = `${e.type}/${e.id}`;
    const category = categoryOf(tags);
    const name = tags.name?.trim() || tags.official_name?.trim() || '';
    const street = [tags['addr:street'] ?? tags['addr:place'], tags['addr:housenumber']].filter(Boolean).join(' ');
    out.push({
      ref, id: idForSourceRef(ref), category,
      osm: { type: e.type, id: e.id, tags, fetchedAt, representative: e.type !== 'node' },
      name: name || `${unnamedLabel(tags, category)} bez nazwy w OSM (${ref})`,
      hasName: !!name,
      locality: tags['addr:city'] ?? tags['addr:place'] ?? '',
      address: street || null,
      lat, lng,
    });
  }
  return out;
}

async function fetchOne(url: string, query: string, signal: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => ctl.abort();
  signal.addEventListener('abort', abort);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ctl.signal, body: new URLSearchParams({ data: query }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (res.status === 429 || res.status === 406) throw new OverpassError('rate-limit', 'Limit zapytań serwera');
    if (!res.ok) throw new OverpassError('server', `Serwer zwrócił błąd ${res.status}`);
    const json = (await res.json().catch(() => null)) as { elements?: unknown[]; remark?: string } | null;
    if (!json || !Array.isArray(json.elements)) throw new OverpassError('invalid', 'Niezrozumiała odpowiedź serwera');
    // Overpass zgłasza przerwane zapytanie jako HTTP 200 z uwagą: to byłby niepełny wynik.
    if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new OverpassError('server', json.remark);
    return json;
  } catch (e) {
    if (e instanceof OverpassError) throw e;
    if ((e as Error).name === 'AbortError') throw new OverpassError('timeout', 'Serwer nie odpowiedział na czas');
    throw new OverpassError('server', 'Brak połączenia z serwerem');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export const ERROR_TEXT: Record<OverpassErrorKind, string> = {
  offline: 'Brak internetu. Zapisane punkty działają normalnie; wyszukiwanie wymaga sieci.',
  timeout: 'Serwery OpenStreetMap nie odpowiedziały na czas. Spróbuj ponownie lub zmniejsz promień.',
  'rate-limit': 'Serwery OpenStreetMap chwilowo ograniczają zapytania. Odczekaj kilka minut i spróbuj ponownie.',
  server: 'Serwery OpenStreetMap są teraz przeciążone. Odczekaj chwilę i spróbuj ponownie.',
  invalid: 'Serwer zwrócił niepoprawne dane. Spróbuj ponownie później.',
};

export async function searchPlaces(
  center: { lat: number; lng: number }, radiusKm: number, cats: SearchCategory[],
  opts: { signal?: AbortSignal; endpoints?: string[]; online?: boolean } = {},
): Promise<{ candidates: Candidate[]; fetchedAt: string; endpoint: string; truncated: boolean }> {
  if ((opts.online ?? navigator.onLine) === false) throw new OverpassError('offline', ERROR_TEXT.offline);
  if (!cats.length) throw new Error('Wybierz co najmniej jeden rodzaj miejsc');
  const limit = radiusLimit(cats);
  if (!(radiusKm >= MIN_RADIUS_KM && radiusKm <= limit)) throw new Error(`Promień musi wynosić ${MIN_RADIUS_KM}–${limit} km`);
  const query = buildQuery(center.lat, center.lng, radiusKm, cats);
  const signal = opts.signal ?? new AbortController().signal;
  let last: OverpassError = new OverpassError('server', ERROR_TEXT.server);
  for (const url of opts.endpoints ?? ENDPOINTS) {
    if (signal.aborted) break;
    try {
      const json = (await fetchOne(url, query, signal)) as { elements: RawElement[] };
      const fetchedAt = new Date().toISOString();
      return { candidates: parseElements(json.elements, fetchedAt), fetchedAt, endpoint: url, truncated: json.elements.length >= MAX_RESULTS };
    } catch (e) {
      last = e as OverpassError;
    }
  }
  throw last;
}

export type CandidateState = 'new' | 'in-base' | 'archived' | 'deleted';

export function candidateState(c: Candidate, points: Point[]): CandidateState {
  const hit = points.find((p) => p.id === c.id || (p.source === 'osm' && p.sourceRef === c.ref));
  return !hit ? 'new' : hit.deletedAt ? 'deleted' : hit.archivedAt ? 'archived' : 'in-base';
}

/** Pobliskie INNE obiekty: tylko ostrzeżenie, nigdy automatyczne scalanie. */
export function possibleDuplicates(c: Candidate, others: { id: string; name: string; lat: number; lng: number }[]) {
  return others.filter((o) => o.id !== c.id && distanceM(c, o) <= NEARBY_DUPLICATE_M);
}

/** Tylko NOWE rekordy: istniejące punkty, ich historia i korekty pozostają nietknięte. */
export function candidateToPoint(c: Candidate, ownerId: string, region: string | null): Point {
  const t = new Date().toISOString();
  return {
    id: c.id, ownerId, name: c.name, placeType: PLACE_FOR[c.category ?? 'fire_station'], locality: c.locality, address: c.address, region,
    lat: c.lat, lng: c.lng, boardLat: null, boardLng: null, source: 'osm', sourceRef: c.ref, osm: c.osm, note: '',
    createdAt: t, updatedAt: t, archivedAt: null, archiveReason: null, deletedAt: null, serverRev: null,
  };
}

export const cacheKey = (lat: number, lng: number, r: number, cats: SearchCategory[]) =>
  `${lat.toFixed(3)},${lng.toFixed(3)},${r},${[...cats].sort().join('+')}`;
