import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ConflictCopy, OutboxOp, Point, Visit } from '../lib/types';

export interface PlakatyDB extends DBSchema {
  points: { key: string; value: Point };
  visits: { key: string; value: Visit; indexes: { byPoint: string } };
  outbox: { key: string; value: OutboxOp };
  conflicts: { key: string; value: ConflictCopy };
  meta: { key: string; value: unknown };
  overpassCache: { key: string; value: { key: string; fetchedAt: string; payload: unknown } };
}

export type Db = IDBPDatabase<PlakatyDB>;

/** Zakres danych: każde konto, tryb demo i tryb lokalny mają OSOBNĄ bazę IndexedDB. */
export type Scope = { kind: 'user'; userId: string; email: string } | { kind: 'demo' } | { kind: 'local' };

export const scopeOwnerId = (s: Scope) => (s.kind === 'user' ? s.userId : s.kind);
export const dbName = (s: Scope) => `plakaty-${scopeOwnerId(s)}`;

export function openScopeDb(scope: Scope): Promise<Db> {
  return openDB<PlakatyDB>(dbName(scope), 1, {
    upgrade(db) {
      db.createObjectStore('points', { keyPath: 'id' });
      db.createObjectStore('visits', { keyPath: 'id' }).createIndex('byPoint', 'pointId');
      db.createObjectStore('outbox', { keyPath: 'key' });
      db.createObjectStore('conflicts', { keyPath: 'id' });
      db.createObjectStore('meta');
      db.createObjectStore('overpassCache', { keyPath: 'key' });
    },
    blocking(_cur, _next, event) {
      // Nowsza wersja aplikacji chce podnieść schemat: zwalniamy połączenie, dane zostają.
      (event.target as IDBDatabase).close();
    },
  });
}
