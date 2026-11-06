import { looksSwapped, parseCoord, validLat, validLng } from '../lib/geo';
import { idForSourceRef, newId } from '../lib/ids';
import { parseCsv } from '../lib/csv';
import type { PlaceType, Point } from '../lib/types';
import { isSameSpot } from './backup';

export interface ImportedRow {
  line: number; name: string; placeType: PlaceType; locality: string; address: string | null; region: string | null;
  lat: number; lng: number; boardLat: number | null; boardLng: number | null; note: string; sourceRef: string | null;
}
export interface PointsParse { rows: ImportedRow[]; errors: string[]; swapped: number }

const TYPES: Record<string, PlaceType> = {
  remiza: 'fire_station', fire_station: 'fire_station', tablica: 'notice_board', notice_board: 'notice_board',
  inne: 'other', inny: 'other', other: 'other', '': 'other',
  'tablica ogłoszeń': 'notice_board', 'inne miejsce': 'other',
};
const ALIASES: Record<string, string[]> = {
  name: ['nazwa', 'name'], type: ['typ', 'type'], locality: ['miejscowosc', 'miejscowość', 'locality'],
  address: ['adres', 'address'], region: ['rejon', 'region'], lat: ['lat', 'latitude', 'szerokosc', 'szerokość'],
  lng: ['lng', 'lon', 'longitude', 'dlugosc', 'długość'], boardLat: ['tablica_lat', 'board_lat'],
  boardLng: ['tablica_lng', 'board_lng'], note: ['notatka', 'note'], ref: ['id_zrodlowe', 'id_źródłowe', 'source_ref'],
};

type Fields = Partial<Record<keyof typeof ALIASES, string>>;

function normalize(fields: Fields, line: number, swap: boolean, out: PointsParse, coords?: { lat: number; lng: number }) {
  const label = `Wiersz ${line}`;
  const name = fields.name?.trim() ?? '';
  if (!name) { out.errors.push(`${label}: brak nazwy`); return; }
  let lat = coords?.lat ?? parseCoord(fields.lat ?? '');
  let lng = coords?.lng ?? parseCoord(fields.lng ?? '');
  if (!validLat(lat) || !validLng(lng)) {
    if (validLat(lng) && validLng(lat) && swap) [lat, lng] = [lng, lat];
    else { out.errors.push(`${label} (${name}): niepoprawne współrzędne`); return; }
  } else if (looksSwapped(lat, lng)) {
    if (swap) [lat, lng] = [lng, lat];
    else { out.swapped++; out.errors.push(`${label} (${name}): współrzędne wyglądają na zamienione miejscami`); return; }
  }
  const bl = fields.boardLat?.trim() ? parseCoord(fields.boardLat) : null;
  const bg = fields.boardLng?.trim() ? parseCoord(fields.boardLng) : null;
  if ((bl === null) !== (bg === null) || (bl !== null && (!validLat(bl) || !validLng(bg!)))) {
    out.errors.push(`${label} (${name}): niepoprawne współrzędne tablicy`); return;
  }
  const placeType = TYPES[(fields.type ?? '').trim().toLowerCase()];
  if (!placeType) { out.errors.push(`${label} (${name}): nieznany typ „${fields.type}”`); return; }
  out.rows.push({
    line, name: name.slice(0, 200), placeType, locality: fields.locality?.trim() ?? '', address: fields.address?.trim() || null,
    region: fields.region?.trim() || null, lat, lng, boardLat: bl, boardLng: bg, note: fields.note?.trim() ?? '',
    sourceRef: fields.ref?.trim() || null,
  });
}

export function parsePointsCsv(text: string, swap = false): PointsParse {
  const out: PointsParse = { rows: [], errors: [], swapped: 0 };
  const { header, rows } = parseCsv(text);
  const col = (k: keyof typeof ALIASES) => header.findIndex((h) => ALIASES[k].includes(h));
  if (col('name') < 0 || col('lat') < 0 || col('lng') < 0) {
    out.errors.push('Brak wymaganych kolumn: nazwa, lat, lng.');
    return out;
  }
  rows.forEach((r, i) => {
    const fields: Fields = {};
    for (const k of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) { const c = col(k); if (c >= 0) fields[k] = r[c]; }
    normalize(fields, i + 2, swap, out);
  });
  return out;
}

export function parsePointsGeoJson(text: string, swap = false): PointsParse {
  const out: PointsParse = { rows: [], errors: [], swapped: 0 };
  let data: { type?: string; features?: unknown[] };
  try { data = JSON.parse(text); } catch { out.errors.push('To nie jest poprawny plik GeoJSON.'); return out; }
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    out.errors.push('Plik musi być kolekcją FeatureCollection.');
    return out;
  }
  data.features.forEach((f, i) => {
    const feat = f as { geometry?: { type?: string; coordinates?: unknown[] }; properties?: Record<string, unknown> };
    const line = i + 1;
    const c = feat.geometry?.coordinates;
    if (feat.geometry?.type !== 'Point' || !Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') {
      out.errors.push(`Obiekt ${line}: wymagana geometria Point [długość, szerokość]`);
      return;
    }
    const props = feat.properties ?? {};
    const fields: Fields = {};
    for (const [k, names] of Object.entries(ALIASES)) {
      const hit = names.find((n) => props[n] != null);
      if (hit) fields[k as keyof typeof ALIASES] = String(props[hit]);
    }
    normalize(fields, line, swap, out, { lng: c[0], lat: c[1] }); // GeoJSON: [lng, lat]
  });
  return out;
}

export interface PointsPlan { create: Point[]; duplicates: number }

export function planPointsImport(rows: ImportedRow[], existing: Point[], ownerId: string): PointsPlan {
  const seen = [...existing];
  const create: Point[] = [];
  let duplicates = 0;
  const t = new Date().toISOString();
  for (const r of rows) {
    const refHit = r.sourceRef && seen.some((p) => p.source === 'import' && p.sourceRef === r.sourceRef);
    if (refHit || seen.some((p) => isSameSpot(p, r))) { duplicates++; continue; }
    const { line: _l, ...rest } = r;
    const p: Point = {
      ...rest, id: r.sourceRef ? idForSourceRef(`import:${r.sourceRef}`) : newId(), ownerId, source: 'import', osm: null,
      createdAt: t, updatedAt: t, archivedAt: null, archiveReason: null, serverRev: null,
    };
    create.push(p);
    seen.push(p);
  }
  return { create, duplicates };
}
