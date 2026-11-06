import type { ActiveTarget, Point } from './types';

export function navigationTarget(p: Point): { lat: number; lng: number; kind: ActiveTarget['kind'] } {
  return p.boardLat != null && p.boardLng != null
    ? { lat: p.boardLat, lng: p.boardLng, kind: 'board' }
    : { lat: p.lat, lng: p.lng, kind: 'object' };
}

/** Oficjalny schemat Google Maps URLs: bez klucza i bez API. */
export function googleMapsUrl(t: { lat: number; lng: number }): string {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${t.lat},${t.lng}`);
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}

export const TARGET_KIND_LABEL: Record<ActiveTarget['kind'], string> = {
  board: 'lokalizacja tablicy',
  object: 'lokalizacja obiektu',
};
