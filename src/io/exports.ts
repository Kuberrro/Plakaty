import { toCsv } from '../lib/csv';
import { STATUS_LABEL, OUTCOME_LABEL, PLACE_LABEL, type Point, type PointStatus, type Visit } from '../lib/types';
import { NO_REGION } from '../lib/stats';
import { navigationTarget } from '../lib/navigation';
import type { ReportResult } from '../lib/stats';
import { formatDateTime, warsawDay } from '../lib/time';

const REPORT_HEADER = ['Data', 'Godzina', 'Miejsce', 'Miejscowość', 'Adres', 'Rejon', 'Szerokość', 'Długość', 'Wynik', 'Plakaty', 'Notatka'];

/** Raport CSV zgodny z aktywnym filtrem; czas w Europe/Warsaw. */
export function reportCsv(report: ReportResult): string {
  const rows = report.visits.map(({ visit: v, point: p }) => [
    warsawDay(v.visitedAt), formatDateTime(v.visitedAt).split(', ')[1] ?? '',
    p?.name ?? '(nieznany punkt)', p?.locality ?? '', p?.address ?? '', p?.region ?? '',
    p?.lat ?? null, p?.lng ?? null, OUTCOME_LABEL[v.outcome], v.posterCount, v.note,
  ]);
  return toCsv([REPORT_HEADER, ...rows]);
}

export function pointsGeoJson(points: Point[], statuses: Map<string, PointStatus>): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: points.filter((p) => !p.archivedAt && !p.deletedAt).map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id, nazwa: p.name, typ: PLACE_LABEL[p.placeType], miejscowosc: p.locality, adres: p.address, rejon: p.region,
        status: STATUS_LABEL[statuses.get(p.id) ?? 'todo'], tablica_lat: p.boardLat, tablica_lng: p.boardLng, notatka: p.note, zrodlo: p.source,
      },
    })),
  }, null, 2);
}

export interface ShareFilter { statuses: PointStatus[]; region: string | null; includeArchived: boolean }

/** Punkty do udostępnienia: nigdy z kosza; status to AKTUALNY status punktu. */
export function pointsForSharing(points: Point[], statuses: Map<string, PointStatus>, f: ShareFilter): Point[] {
  return points
    .filter((p) => !p.deletedAt && (f.includeArchived || !p.archivedAt))
    .filter((p) => f.statuses.includes(statuses.get(p.id) ?? 'todo'))
    .filter((p) => !f.region || (f.region === NO_REGION ? !p.region : p.region === f.region))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export const MY_MAPS_MAX_ROWS = 2000;

/**
 * CSV dla Google Moje Mapy: przecinek, kropka dziesiętna, UTF-8, kolumny Latitude/Longitude.
 * Pozycja = tablica, jeśli zapisana (tam wisi plakat), w przeciwnym razie obiekt.
 */
export function myMapsCsv(points: Point[], visits: Visit[], statuses: Map<string, PointStatus>, includeNotes: boolean): string {
  const live = visits.filter((v) => !v.cancelledAt);
  const header = ['Nazwa', 'Latitude', 'Longitude', 'Status', 'Rodzaj', 'Miejscowość', 'Adres', 'Rejon', 'Plakaty', 'Ostatnia wizyta'];
  if (includeNotes) header.push('Notatka');
  const rows = points.map((p) => {
    const mine = live.filter((v) => v.pointId === p.id);
    const last = mine.reduce<string | null>((m, v) => (!m || v.visitedAt > m ? v.visitedAt : m), null);
    const pos = navigationTarget(p);
    const row: (string | number | null)[] = [
      p.name, pos.lat, pos.lng, STATUS_LABEL[statuses.get(p.id) ?? 'todo'], PLACE_LABEL[p.placeType] ?? '', p.locality,
      p.address ?? '', p.region ?? '', mine.reduce((s, v) => s + v.posterCount, 0), last ? warsawDay(last) : '',
    ];
    if (includeNotes) row.push(p.note);
    return row;
  });
  return toCsv([header, ...rows], ',', false);
}
