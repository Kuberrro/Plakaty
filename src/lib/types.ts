export type PlaceType = 'fire_station' | 'notice_board' | 'other';
export type PointSource = 'osm' | 'manual' | 'import';
export type Outcome = 'posted' | 'return' | 'impossible';
export type PointStatus = 'todo' | Outcome;

export interface OsmMeta {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Record<string, string>;
  fetchedAt: string;
  /** Współrzędne są punktem reprezentatywnym obiektu powierzchniowego, nie wejściem. */
  representative: boolean;
}

export interface Point {
  id: string;
  ownerId: string;
  name: string;
  placeType: PlaceType;
  locality: string;
  address: string | null;
  region: string | null;
  lat: number;
  lng: number;
  boardLat: number | null;
  boardLng: number | null;
  source: PointSource;
  sourceRef: string | null;
  osm: OsmMeta | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archiveReason: string | null;
  /** Wersja wiersza w chmurze, którą znamy. null = jeszcze nie było w chmurze. */
  serverRev: number | null;
}

export interface VisitGps {
  lat: number;
  lng: number;
  accuracyM: number | null;
  measuredAt: string;
}

export interface VisitCorrection {
  at: string;
  before: { visitedAt: string; outcome: Outcome; posterCount: number; note: string };
}

export interface Visit {
  id: string;
  ownerId: string;
  pointId: string;
  visitedAt: string;
  outcome: Outcome;
  posterCount: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  gps: VisitGps | null;
  corrections: VisitCorrection[];
  serverRev: number | null;
}

export interface ActiveTarget {
  pointId: string;
  startedAt: string;
  lat: number;
  lng: number;
  /** Do czego prowadzi nawigacja: tablica czy obiekt. */
  kind: 'board' | 'object';
}

export type EntityName = 'point' | 'visit';

export interface OutboxOp {
  key: string; // "point:<uuid>"
  entity: EntityName;
  entityId: string;
  seq: number;
  opId: string;
  /** Wszystkie opId, które mogły już dotrzeć do serwera (utracona odpowiedź). */
  sentOpIds: string[];
  attempts: number;
  lastError: string | null;
}

export interface ConflictCopy {
  id: string;
  entity: EntityName;
  entityId: string;
  at: string;
  /** Skąd pochodzi zachowana tu wersja, która NIE została aktywna. */
  origin: 'cloud' | 'device' | 'import';
  version: Point | Visit;
}

export const STATUS_LABEL: Record<PointStatus, string> = {
  todo: 'Do odwiedzenia',
  posted: 'Plakat powieszony',
  return: 'Wrócić',
  impossible: 'Brak możliwości',
};
export const STATUS_SYMBOL: Record<PointStatus, string> = { todo: '○', posted: '✓', return: '↻', impossible: '✕' };
export const OUTCOME_LABEL: Record<Outcome, string> = {
  posted: 'Plakat powieszony',
  return: 'Wrócić',
  impossible: 'Brak możliwości',
};
export const PLACE_LABEL: Record<PlaceType, string> = {
  fire_station: 'Remiza',
  notice_board: 'Tablica ogłoszeń',
  other: 'Inne miejsce',
};
