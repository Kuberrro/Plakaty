import { newId } from '../lib/ids';
import type { ConflictCopy, OutboxOp, Point, Visit } from '../lib/types';
import type { Repository } from '../data/repository';
import { BackendError, type SyncBackend, type Table } from './backend';
import { pointToRow, rowToPoint, rowToVisit, sameContent, visitToRow, type Row } from './mapping';

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'auth';
export interface SyncState { phase: SyncPhase; lastSyncAt: string | null; message: string | null }

const PAGE = 500;
const OVERLAP_MS = 60_000; // zakładka: zmiany zatwierdzone w trakcie poprzedniego pobrania
const CURSOR = (t: Table) => `cursor:${t}`;
const LAST_SYNC = 'lastSyncAt';

/**
 * Kolejność: najpierw wysyłka, potem pobranie.
 * Konflikt (ktoś inny zmienił rekord): wygrywa wersja z późniejszym updatedAt,
 * a druga trafia do „Konfliktów” w Ustawieniach. Nic nie jest po cichu usuwane.
 * Ponawianie tylko na żądanie zdarzenia (start, powrót sieci, zmiana, przycisk), bez pętli.
 */
export class SyncEngine {
  private state: SyncState = { phase: 'idle', lastSyncAt: null, message: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private repo: Repository, private backend: SyncBackend) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(p: Partial<SyncState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }

  async init() {
    this.set({ lastSyncAt: (await this.repo.getMeta<string>(LAST_SYNC)) ?? null });
  }

  /** Bezpieczne przy równoległych wywołaniach: drugie dokleja jeden kolejny przebieg. */
  sync(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) { this.again = false; void this.sync(); }
    });
    return this.running;
  }

  private async run() {
    this.set({ phase: 'syncing', message: null });
    try {
      const userId = await this.backend.currentUserId();
      if (!userId) throw new BackendError('Zaloguj się ponownie, aby zsynchronizować dane.', 'auth');
      if (userId !== this.repo.ownerId) throw new BackendError('Zalogowane konto nie jest właścicielem tych danych. Przerwano.', 'auth');

      let rejected = 0;
      for (const op of this.repo.pendingOps()) {
        try {
          await this.push(op, userId);
        } catch (e) {
          if (!(e instanceof BackendError) || e.kind !== 'rejected') throw e;
          rejected++;
          await this.repo.markFailed(op, e.message);
        }
      }
      const started = new Date().toISOString();
      await this.pull(userId);
      await this.repo.setMeta(LAST_SYNC, started);
      this.set(rejected
        ? { phase: 'error', lastSyncAt: started, message: `Serwer odrzucił zmiany: ${rejected}. Dane zostały na telefonie.` }
        : { phase: 'idle', lastSyncAt: started, message: null });
    } catch (e) {
      const kind = e instanceof BackendError ? e.kind : 'network';
      this.set({ phase: kind === 'auth' ? 'auth' : 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private toRow(op: OutboxOp, userId: string, opId: string): Row | null {
    const rec = this.repo.getEntity(op.entity, op.entityId);
    if (!rec) return null;
    return op.entity === 'point' ? pointToRow(rec as Point, userId, opId) : visitToRow(rec as Visit, userId, opId);
  }

  private async push(initial: OutboxOp, userId: string, depth = 0): Promise<void> {
    if (depth > 3) throw new BackendError('Rekord zmienia się w chmurze zbyt często. Spróbuj ponownie.', 'rejected');
    const table: Table = initial.entity === 'point' ? 'points' : 'visits';
    const op = await this.repo.markSent(initial);
    const row = this.toRow(op, userId, op.opId);
    if (!row) return;
    const rec = this.repo.getEntity(op.entity, op.entityId)!;

    const applied = rec.serverRev == null
      ? await this.backend.insertIfAbsent(table, row)
      : await this.backend.updateIfRev(table, row, rec.serverRev);
    if (applied) return this.repo.acknowledge(op, applied.server_rev as number);

    // Nie przyjęto: wiersz istnieje w innej wersji albo zniknął z chmury.
    const remote = await this.backend.get(table, userId, op.entityId);
    if (!remote) {
      const inserted = await this.backend.insertIfAbsent(table, row);
      if (inserted) return this.repo.acknowledge(op, inserted.server_rev as number);
      return this.push(op, userId, depth + 1);
    }
    const rev = remote.server_rev as number;
    if (remote.last_op_id === op.opId) return this.repo.acknowledge(op, rev); // utracona odpowiedź
    if (op.sentOpIds.includes(remote.last_op_id as string)) {
      // Dotarła nasza wcześniejsza wersja; bieżącą wysyłamy na jej podstawie.
      await this.repo.rebase(op.entity, op.entityId, rev);
      return this.push(op, userId, depth + 1);
    }
    const remoteRec = op.entity === 'point' ? rowToPoint(remote, userId) : rowToVisit(remote, userId);
    if (sameContent(rec, remoteRec)) return this.repo.acknowledge(op, rev);

    const copy = (version: Point | Visit, origin: ConflictCopy['origin']): ConflictCopy => ({
      id: newId(), entity: op.entity, entityId: op.entityId, at: new Date().toISOString(), origin, version,
    });
    if (Date.parse(rec.updatedAt) >= Date.parse(remoteRec.updatedAt)) {
      await this.repo.addConflictCopy(copy(remoteRec, 'cloud'));
      await this.repo.rebase(op.entity, op.entityId, rev);
      return this.push(op, userId, depth + 1);
    }
    await this.repo.acceptRemote(op, remoteRec, copy({ ...rec }, 'device'));
  }

  private async pull(userId: string) {
    for (const table of ['points', 'visits'] as Table[]) {
      const cursor = await this.repo.getMeta<string>(CURSOR(table));
      const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
      let newest = cursor ?? null;
      for (let offset = 0; ; offset += PAGE) {
        const rows = await this.backend.list(table, { since, offset, limit: PAGE });
        const mine = rows.filter((r) => r.user_id === userId);
        await this.repo.applyRemote(
          table === 'points' ? mine.map((r) => rowToPoint(r, userId)) : [],
          table === 'visits' ? mine.map((r) => rowToVisit(r, userId)) : [],
        );
        for (const r of mine) {
          const t = new Date(r.server_updated_at as string).toISOString();
          if (!newest || t > newest) newest = t;
        }
        if (rows.length < PAGE) break;
      }
      if (newest) await this.repo.setMeta(CURSOR(table), newest);
    }
  }
}
