import { deleteDB } from 'idb';
import { idForSourceRef } from '../lib/ids';
import type { Outcome, Point, Visit } from '../lib/types';
import { dbName } from './db';
import type { Repository } from './repository';

/**
 * Dane fikcyjne: nazwy wprost mówią, że to demo, a współrzędne to regularna siatka,
 * a nie prawdziwe remizy. Trafiają wyłącznie do osobnej bazy plakaty-demo.
 * Stałe id: dwukrotne zasianie nie tworzy duplikatów.
 */
export async function seedDemo(repo: Repository) {
  if (repo.getSnapshot().points.length) return;
  const t = new Date();
  const iso = (daysAgo: number) => new Date(t.getTime() - daysAgo * 86400_000).toISOString();
  const regions = ['Demo Północ', 'Demo Południe', 'Demo Zachód'];
  const points: Point[] = Array.from({ length: 12 }, (_, i) => ({
    id: idForSourceRef(`demo-point-${i}`), ownerId: repo.ownerId, name: `Punkt demonstracyjny ${i + 1} (fikcyjny)`,
    placeType: i % 4 === 3 ? 'notice_board' : 'other', locality: 'Miejscowość demonstracyjna', address: null,
    region: regions[i % 3], lat: 50.0 + (i % 4) * 0.05, lng: 19.75 + Math.floor(i / 4) * 0.12,
    boardLat: null, boardLng: null, source: 'manual', sourceRef: null, osm: null, note: 'Dane demonstracyjne.',
    createdAt: iso(10), updatedAt: iso(10), archivedAt: null, archiveReason: null, serverRev: null,
  }));
  const visit = (p: Point, daysAgo: number, outcome: Outcome, posterCount: number): Visit => ({
    id: idForSourceRef(`demo-visit-${p.id}`), ownerId: repo.ownerId, pointId: p.id, visitedAt: iso(daysAgo), outcome, posterCount, note: '',
    createdAt: iso(daysAgo), updatedAt: iso(daysAgo), cancelledAt: null, cancelReason: null, gps: null, corrections: [], serverRev: null,
  });
  await repo.commit({ points, visits: [visit(points[0], 2, 'posted', 2), visit(points[1], 1, 'return', 0), visit(points[2], 1, 'impossible', 0)] });
}

export const clearDemo = () => deleteDB(dbName({ kind: 'demo' }));
