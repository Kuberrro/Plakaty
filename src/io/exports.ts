import { toCsv } from '../lib/csv';
import { STATUS_LABEL, OUTCOME_LABEL, PLACE_LABEL, type Point, type PointStatus } from '../lib/types';
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
    features: points.filter((p) => !p.archivedAt).map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id, nazwa: p.name, typ: PLACE_LABEL[p.placeType], miejscowosc: p.locality, adres: p.address, rejon: p.region,
        status: STATUS_LABEL[statuses.get(p.id) ?? 'todo'], tablica_lat: p.boardLat, tablica_lng: p.boardLng, notatka: p.note, zrodlo: p.source,
      },
    })),
  }, null, 2);
}
