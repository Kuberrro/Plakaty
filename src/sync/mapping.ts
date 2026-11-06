import type { Point, Visit } from '../lib/types';

export type Row = Record<string, unknown>;

export function pointToRow(p: Point, userId: string, opId: string): Row {
  return {
    user_id: userId, id: p.id, name: p.name, place_type: p.placeType, locality: p.locality, address: p.address,
    region: p.region, lat: p.lat, lng: p.lng, board_lat: p.boardLat, board_lng: p.boardLng, source: p.source,
    source_ref: p.sourceRef, osm: p.osm, note: p.note, created_at: p.createdAt, updated_at: p.updatedAt,
    archived_at: p.archivedAt, archive_reason: p.archiveReason, last_op_id: opId,
  };
}

const iso = (s: unknown) => new Date(s as string).toISOString();
const isoN = (s: unknown) => (s == null ? null : iso(s));

export function rowToPoint(r: Row, ownerId: string): Point {
  return {
    id: r.id as string, ownerId, name: r.name as string, placeType: r.place_type as Point['placeType'],
    locality: r.locality as string, address: r.address as string | null, region: r.region as string | null,
    lat: r.lat as number, lng: r.lng as number, boardLat: r.board_lat as number | null, boardLng: r.board_lng as number | null,
    source: r.source as Point['source'], sourceRef: r.source_ref as string | null, osm: r.osm as Point['osm'],
    note: r.note as string, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    archivedAt: isoN(r.archived_at), archiveReason: r.archive_reason as string | null, serverRev: r.server_rev as number,
  };
}

export function visitToRow(v: Visit, userId: string, opId: string): Row {
  return {
    user_id: userId, id: v.id, point_id: v.pointId, visited_at: v.visitedAt, outcome: v.outcome,
    poster_count: v.posterCount, note: v.note, created_at: v.createdAt, updated_at: v.updatedAt,
    cancelled_at: v.cancelledAt, cancel_reason: v.cancelReason, gps_lat: v.gps?.lat ?? null, gps_lng: v.gps?.lng ?? null,
    gps_accuracy_m: v.gps?.accuracyM ?? null, gps_measured_at: v.gps?.measuredAt ?? null, corrections: v.corrections,
    last_op_id: opId,
  };
}

export function rowToVisit(r: Row, ownerId: string): Visit {
  return {
    id: r.id as string, ownerId, pointId: r.point_id as string, visitedAt: iso(r.visited_at), outcome: r.outcome as Visit['outcome'],
    posterCount: r.poster_count as number, note: r.note as string, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    cancelledAt: isoN(r.cancelled_at), cancelReason: r.cancel_reason as string | null,
    gps: r.gps_lat == null ? null : {
      lat: r.gps_lat as number, lng: r.gps_lng as number, accuracyM: r.gps_accuracy_m as number | null, measuredAt: iso(r.gps_measured_at),
    },
    corrections: (r.corrections as Visit['corrections']) ?? [], serverRev: r.server_rev as number,
  };
}

/** Porównanie treści bez pól technicznych: ta sama treść to nie konflikt. */
export function sameContent(a: Point | Visit, b: Point | Visit): boolean {
  const strip = (x: Point | Visit) => {
    const { updatedAt: _u, createdAt: _c, serverRev: _s, ...rest } = x;
    return rest;
  };
  const canon = (o: unknown): unknown =>
    Array.isArray(o) ? o.map(canon)
    : o && typeof o === 'object'
      ? Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, canon(v)]))
      : o;
  return JSON.stringify(canon(strip(a))) === JSON.stringify(canon(strip(b)));
}
