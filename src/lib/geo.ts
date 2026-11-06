export interface LatLng { lat: number; lng: number }

/** Odległość w LINII PROSTEJ (haversine). To nie jest długość ani czas dojazdu. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  const v = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${v} w linii prostej`;
}

export const validLat = (n: number) => Number.isFinite(n) && n >= -90 && n <= 90;
export const validLng = (n: number) => Number.isFinite(n) && n >= -180 && n <= 180;

/** Poland: rozpoznaje zamienione kolejnością współrzędne, gdy tylko zamiana daje punkt w Polsce. */
const inPoland = (lat: number, lng: number) => lat >= 49 && lat <= 55 && lng >= 14 && lng <= 24.2;
export const looksSwapped = (lat: number, lng: number) => !inPoland(lat, lng) && inPoland(lng, lat);

export function parseCoord(s: string): number {
  return Number(s.trim().replace(',', '.'));
}
