import { IDBFactory } from 'fake-indexeddb';
import { openScopeDb, type Scope } from '../../src/data/db';
import { Repository } from '../../src/data/repository';
import { createManualPoint, type PointDraft } from '../../src/data/actions';
import { rowToPoint, rowToVisit, type Row } from '../../src/sync/mapping';
import { BackendError, type PageQuery, type SyncBackend, type Table } from '../../src/sync/backend';

export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const scope = (userId = USER): Scope => ({ kind: 'user', userId, email: 'a@test' });

export function freshIdb() { globalThis.indexedDB = new IDBFactory(); }

export async function repoFor(userId = USER, trackSync = true) {
  return new Repository(await openScopeDb(scope(userId)), userId, trackSync).load();
}

export const draft = (over: Partial<PointDraft> = {}): PointDraft => ({
  name: 'Testowy punkt', placeType: 'other', locality: 'Testowo', address: null, region: 'Północ',
  lat: 50.1, lng: 19.9, boardLat: null, boardLng: null, note: '', ...over,
});
export const point = (repo: Repository, over: Partial<PointDraft> = {}) => createManualPoint(repo, draft(over));

/** Zachowuje się jak PostgREST + wyzwalacz stamp_row. Prawdziwy serwer testuje test:rls. */
export class FakeServer implements SyncBackend {
  tables: Record<Table, Map<string, Row>> = { points: new Map(), visits: new Map() };
  user: string | null = USER;
  calls = 0;
  /** Zapis dochodzi do serwera, ale odpowiedź ginie w sieci. */
  loseNextResponse = false;
  failNetwork = false;
  clock = 1_700_000_000_000;

  private stamp(row: Row, rev: number): Row {
    return { ...row, server_rev: rev, server_updated_at: new Date((this.clock += 1000)).toISOString() };
  }
  private gate() {
    this.calls++;
    if (this.failNetwork) throw new BackendError('Błąd połączenia', 'network');
  }
  private deliver(r: Row): Row {
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new BackendError('Utracona odpowiedź', 'network'); }
    return r;
  }
  async currentUserId() { return this.user; }
  async insertIfAbsent(t: Table, row: Row) {
    this.gate();
    const k = `${row.user_id}:${row.id}`;
    if (this.tables[t].has(k)) return null;
    const stored = this.stamp(row, 1);
    this.tables[t].set(k, stored);
    return this.deliver(stored);
  }
  async updateIfRev(t: Table, row: Row, rev: number) {
    this.gate();
    const k = `${row.user_id}:${row.id}`;
    const cur = this.tables[t].get(k);
    if (!cur || cur.server_rev !== rev) return null;
    const stored = this.stamp(row, rev + 1);
    this.tables[t].set(k, stored);
    return this.deliver(stored);
  }
  async get(t: Table, userId: string, id: string) { this.gate(); return this.tables[t].get(`${userId}:${id}`) ?? null; }
  async list(t: Table, q: PageQuery) {
    this.gate();
    return [...this.tables[t].values()]
      .filter((r) => r.user_id === this.user && (!q.since || (r.server_updated_at as string) > q.since))
      .sort((a, b) => (a.server_updated_at as string).localeCompare(b.server_updated_at as string))
      .slice(q.offset, q.offset + q.limit);
  }
  /** Zmiana wykonana z innego urządzenia. */
  remoteEdit(t: Table, id: string, patch: Row, userId = USER) {
    const k = `${userId}:${id}`;
    const cur = this.tables[t].get(k)!;
    this.tables[t].set(k, this.stamp({ ...cur, ...patch, last_op_id: '99999999-9999-4999-8999-999999999999' }, (cur.server_rev as number) + 1));
  }
  points(userId = USER) { return [...this.tables.points.values()].filter((r) => r.user_id === userId).map((r) => rowToPoint(r, userId)); }
  visits(userId = USER) { return [...this.tables.visits.values()].filter((r) => r.user_id === userId).map((r) => rowToVisit(r, userId)); }
}
