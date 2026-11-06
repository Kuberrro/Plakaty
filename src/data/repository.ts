import { newId } from '../lib/ids';
import { statusMap } from '../lib/status';
import type {
  ActiveTarget, ConflictCopy, EntityName, OutboxOp, Point, PointStatus, Visit,
} from '../lib/types';
import type { Db } from './db';

export interface Snapshot {
  points: Point[];
  visits: Visit[];
  statuses: Map<string, PointStatus>;
  outbox: Map<string, OutboxOp>;
  conflicts: ConflictCopy[];
  activeTarget: ActiveTarget | null;
  lastBackupAt: string | null;
}

export interface Changes {
  points?: Point[];
  visits?: Visit[];
  conflicts?: ConflictCopy[];
  /** undefined = bez zmian; null = usuń aktywny cel. */
  activeTarget?: ActiveTarget | null;
}

const ACTIVE = 'activeTarget';
const BACKUP = 'lastBackupAt';
export const outboxKey = (e: EntityName, id: string) => `${e}:${id}`;

/**
 * Jedyna droga zapisu danych. Każda zmiana to JEDNA transakcja IndexedDB
 * (rekord + wpis w kolejce). Stan w pamięci i UI zmieniają się dopiero
 * po trwałym zatwierdzeniu transakcji, więc nie ma przedwczesnych potwierdzeń.
 */
export class Repository {
  private points = new Map<string, Point>();
  private visits = new Map<string, Visit>();
  private outbox = new Map<string, OutboxOp>();
  private conflicts = new Map<string, ConflictCopy>();
  private activeTarget: ActiveTarget | null = null;
  private lastBackupAt: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot!: Snapshot;
  private seq = Date.now();
  /** Wywoływane po każdej lokalnej zmianie (np. żeby uruchomić synchronizację). */
  onLocalChange: (() => void) | null = null;

  constructor(readonly db: Db, readonly ownerId: string, readonly trackSync: boolean) {}

  async load(): Promise<this> {
    const [points, visits, outbox, conflicts, active, backup] = await Promise.all([
      this.db.getAll('points'), this.db.getAll('visits'), this.db.getAll('outbox'), this.db.getAll('conflicts'),
      this.db.get('meta', ACTIVE), this.db.get('meta', BACKUP),
    ]);
    this.points = new Map(points.map((p) => [p.id, p]));
    this.visits = new Map(visits.map((v) => [v.id, v]));
    this.outbox = new Map(outbox.map((o) => [o.key, o]));
    this.conflicts = new Map(conflicts.map((c) => [c.id, c]));
    this.activeTarget = (active as ActiveTarget | undefined) ?? null;
    this.lastBackupAt = (backup as string | undefined) ?? null;
    this.seq = Math.max(this.seq, ...outbox.map((o) => o.seq + 1));
    this.rebuild();
    return this;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;

  private rebuild() {
    const points = [...this.points.values()];
    const visits = [...this.visits.values()];
    this.snapshot = {
      points, visits,
      statuses: statusMap(this.points.keys(), visits),
      outbox: new Map(this.outbox),
      conflicts: [...this.conflicts.values()].sort((a, b) => b.at.localeCompare(a.at)),
      activeTarget: this.activeTarget,
      lastBackupAt: this.lastBackupAt,
    };
    this.listeners.forEach((l) => l());
  }

  getPoint = (id: string) => this.points.get(id);
  getVisit = (id: string) => this.visits.get(id);
  getEntity = (e: EntityName, id: string) => (e === 'point' ? this.points.get(id) : this.visits.get(id));
  pendingOps = () => [...this.outbox.values()].sort((a, b) =>
    (a.entity === b.entity ? 0 : a.entity === 'point' ? -1 : 1) || a.seq - b.seq);
  hasPending = (e: EntityName, id: string) => this.outbox.has(outboxKey(e, id));

  private enqueue(e: EntityName, id: string, ops: OutboxOp[]): OutboxOp {
    const key = outboxKey(e, id);
    const prev = this.outbox.get(key);
    const op: OutboxOp = {
      key, entity: e, entityId: id, seq: prev?.seq ?? ++this.seq, opId: newId(),
      sentOpIds: prev?.sentOpIds ?? [], attempts: 0, lastError: null,
    };
    ops.push(op);
    return op;
  }

  /** Lokalna zmiana użytkownika. Rzuca wyjątek, gdy zapis się nie uda; stan się wtedy nie zmienia. */
  async commit(c: Changes): Promise<void> {
    const ops: OutboxOp[] = [];
    const tx = this.db.transaction(['points', 'visits', 'outbox', 'conflicts', 'meta'], 'readwrite');
    try {
      const writes: Promise<unknown>[] = [];
      for (const p of c.points ?? []) {
        writes.push(tx.objectStore('points').put(p));
        if (this.trackSync) writes.push(tx.objectStore('outbox').put(this.enqueue('point', p.id, ops)));
      }
      for (const v of c.visits ?? []) {
        writes.push(tx.objectStore('visits').put(v));
        if (this.trackSync) writes.push(tx.objectStore('outbox').put(this.enqueue('visit', v.id, ops)));
      }
      for (const x of c.conflicts ?? []) writes.push(tx.objectStore('conflicts').put(x));
      if (c.activeTarget !== undefined) {
        writes.push(c.activeTarget ? tx.objectStore('meta').put(c.activeTarget, ACTIVE) : tx.objectStore('meta').delete(ACTIVE));
      }
      await Promise.all([...writes, tx.done]);
    } catch (e) {
      try { tx.abort(); } catch { /* transakcja już przerwana */ }
      throw e;
    }
    for (const p of c.points ?? []) this.points.set(p.id, p);
    for (const v of c.visits ?? []) this.visits.set(v.id, v);
    for (const x of c.conflicts ?? []) this.conflicts.set(x.id, x);
    for (const o of ops) this.outbox.set(o.key, o);
    if (c.activeTarget !== undefined) this.activeTarget = c.activeTarget;
    this.rebuild();
    this.onLocalChange?.();
  }

  async setLastBackup(iso: string) {
    await this.db.put('meta', iso, BACKUP);
    this.lastBackupAt = iso;
    this.rebuild();
  }

  async dismissConflict(id: string) {
    await this.db.delete('conflicts', id);
    this.conflicts.delete(id);
    this.rebuild();
  }

  async getMeta<T>(key: string): Promise<T | undefined> { return (await this.db.get('meta', key)) as T | undefined; }
  async setMeta(key: string, value: unknown) { await this.db.put('meta', value, key); }

  // ---- API synchronizacji: nie tworzy nowych wpisów w kolejce ----

  /** Zapamiętuje PRZED wysłaniem, że ta operacja mogła dotrzeć do serwera. */
  async markSent(op: OutboxOp): Promise<OutboxOp> {
    const cur = this.outbox.get(op.key) ?? op;
    const next = { ...cur, attempts: cur.attempts + 1, sentOpIds: [...new Set([...cur.sentOpIds, cur.opId])].slice(-20) };
    await this.db.put('outbox', next);
    this.outbox.set(op.key, next);
    return next;
  }

  async markFailed(op: OutboxOp, message: string) {
    const cur = this.outbox.get(op.key);
    if (!cur) return;
    const next = { ...cur, lastError: message };
    await this.db.put('outbox', next);
    this.outbox.set(op.key, next);
    this.rebuild();
  }

  /**
   * Serwer przyjął operację opId jako wersję rev. Jeśli w międzyczasie użytkownik
   * zmienił rekord (nowy opId), wpis w kolejce zostaje, a aktualizujemy tylko bazę wersji.
   */
  async acknowledge(op: OutboxOp, rev: number) {
    const tx = this.db.transaction(['points', 'visits', 'outbox'], 'readwrite');
    const current = await tx.objectStore('outbox').get(op.key);
    const store = op.entity === 'point' ? tx.objectStore('points') : tx.objectStore('visits');
    const rec = await store.get(op.entityId);
    if (rec) await store.put({ ...rec, serverRev: rev } as never);
    const done = !current || current.opId === op.opId;
    if (done) await tx.objectStore('outbox').delete(op.key);
    else await tx.objectStore('outbox').put({ ...current, sentOpIds: [], lastError: null });
    await tx.done;
    this.patchServerRev(op.entity, op.entityId, rev);
    if (done) this.outbox.delete(op.key);
    else this.outbox.set(op.key, { ...current!, sentOpIds: [], lastError: null });
    this.rebuild();
  }

  private patchServerRev(e: EntityName, id: string, rev: number) {
    if (e === 'point') { const r = this.points.get(id); if (r) this.points.set(id, { ...r, serverRev: rev }); }
    else { const r = this.visits.get(id); if (r) this.visits.set(id, { ...r, serverRev: rev }); }
  }

  /** Uznajemy wskazaną wersję serwera za bazę kolejnej próby, nie zmieniając treści. */
  async rebase(e: EntityName, id: string, rev: number) {
    const store = e === 'point' ? 'points' : 'visits';
    const rec = await this.db.get(store, id);
    if (rec) await this.db.put(store, { ...rec, serverRev: rev } as never);
    this.patchServerRev(e, id, rev);
  }

  /** Konflikt przegrany lokalnie: wersja z chmury staje się aktywna, lokalna trafia do kopii. */
  async acceptRemote(op: OutboxOp, remote: Point | Visit, lost: ConflictCopy) {
    const tx = this.db.transaction(['points', 'visits', 'outbox', 'conflicts'], 'readwrite');
    if (op.entity === 'point') await tx.objectStore('points').put(remote as Point);
    else await tx.objectStore('visits').put(remote as Visit);
    await tx.objectStore('conflicts').put(lost);
    await tx.objectStore('outbox').delete(op.key);
    await tx.done;
    if (op.entity === 'point') this.points.set(op.entityId, remote as Point);
    else this.visits.set(op.entityId, remote as Visit);
    this.conflicts.set(lost.id, lost);
    this.outbox.delete(op.key);
    this.rebuild();
  }

  async addConflictCopy(copy: ConflictCopy) {
    await this.db.put('conflicts', copy);
    this.conflicts.set(copy.id, copy);
    this.rebuild();
  }

  /**
   * Scala rekordy pobrane z chmury. Rekord z niewysłaną zmianą NIGDY nie jest nadpisywany:
   * ewentualny konflikt rozstrzyga wysyłka, zachowując przegraną wersję.
   */
  async applyRemote(points: Point[], visits: Visit[]): Promise<number> {
    const tx = this.db.transaction(['points', 'visits', 'outbox'], 'readwrite');
    const pendingKeys = new Set(await tx.objectStore('outbox').getAllKeys());
    const newPoints: Point[] = [];
    const newVisits: Visit[] = [];
    for (const r of points) {
      if (pendingKeys.has(outboxKey('point', r.id))) continue;
      const cur = await tx.objectStore('points').get(r.id);
      if (cur && (cur.serverRev ?? 0) >= (r.serverRev ?? 0)) continue;
      await tx.objectStore('points').put(r);
      newPoints.push(r);
    }
    for (const r of visits) {
      if (pendingKeys.has(outboxKey('visit', r.id))) continue;
      const cur = await tx.objectStore('visits').get(r.id);
      if (cur && (cur.serverRev ?? 0) >= (r.serverRev ?? 0)) continue;
      await tx.objectStore('visits').put(r);
      newVisits.push(r);
    }
    await tx.done;
    for (const r of newPoints) this.points.set(r.id, r);
    for (const r of newVisits) this.visits.set(r.id, r);
    if (newPoints.length || newVisits.length) this.rebuild();
    return newPoints.length + newVisits.length;
  }
}
