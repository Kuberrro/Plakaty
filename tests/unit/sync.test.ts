import { beforeEach, describe, expect, it } from 'vitest';
import { addVisit, updatePoint, type VisitDraft } from '../../src/data/actions';
import type { Repository } from '../../src/data/repository';
import { SyncEngine } from '../../src/sync/engine';
import { FakeServer, freshIdb, OTHER, point, repoFor, USER } from './helpers';

beforeEach(freshIdb);
const vd = (pointId: string): VisitDraft => ({ pointId, visitedAt: '2026-05-01T10:00:00.000Z', outcome: 'posted', posterCount: 1, note: '', gps: null });
async function setup() {
  const server = new FakeServer();
  const repo = await repoFor();
  const engine = new SyncEngine(repo, server);
  return { server, repo, engine };
}
const pending = (r: Repository) => r.getSnapshot().outbox.size;

describe('wysyłka', () => {
  it('wysyła punkt przed wizytą i czyści kolejkę', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await addVisit(repo, vd(p.id));
    await engine.sync();
    expect(engine.getState().phase).toBe('idle');
    expect(pending(repo)).toBe(0);
    expect(server.visits()).toHaveLength(1);
    expect(repo.getPoint(p.id)!.serverRev).toBe(1);
  });
  it('offline: dane zostają, po powrocie sieci idą raz', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await addVisit(repo, vd(p.id));
    server.failNetwork = true;
    await engine.sync();
    expect(engine.getState().phase).toBe('error');
    expect(pending(repo)).toBe(2);
    server.failNetwork = false;
    await engine.sync();
    await engine.sync();
    expect(server.visits()).toHaveLength(1);
    expect(pending(repo)).toBe(0);
  });
  it('utracona odpowiedź przy wstawianiu nie dubluje wizyty ani nie robi konfliktu', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    await addVisit(repo, vd(p.id));
    server.loseNextResponse = true;
    await engine.sync();
    expect(pending(repo)).toBe(1);
    await engine.sync();
    expect(server.visits()).toHaveLength(1);
    expect(pending(repo)).toBe(0);
    expect(repo.getSnapshot().conflicts).toHaveLength(0);
  });
  it('utracona odpowiedź przy edycji nie tworzy konfliktu', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    await updatePoint(repo, repo.getPoint(p.id)!, { name: 'Nowa' });
    server.loseNextResponse = true;
    await engine.sync();
    await engine.sync();
    expect(server.points()[0].name).toBe('Nowa');
    expect(server.points()[0].serverRev).toBe(2);
    expect(repo.getSnapshot().conflicts).toHaveLength(0);
  });
  it('edycja po utraconej odpowiedzi: wysyła najnowszą wersję bez konfliktu', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    server.loseNextResponse = true;
    await engine.sync();
    await updatePoint(repo, repo.getPoint(p.id)!, { name: 'Po edycji' });
    await engine.sync();
    expect(server.points()[0].name).toBe('Po edycji');
    expect(pending(repo)).toBe(0);
    expect(repo.getSnapshot().conflicts).toHaveLength(0);
  });
  it('zmiana w trakcie wysyłki nie ginie', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    const orig = server.insertIfAbsent.bind(server);
    server.insertIfAbsent = async (t, r) => {
      const res = await orig(t, r);
      await updatePoint(repo, repo.getPoint(p.id)!, { name: 'W trakcie' });
      server.insertIfAbsent = orig;
      return res;
    };
    await engine.sync();
    expect(pending(repo)).toBe(1);
    await engine.sync();
    expect(server.points()[0].name).toBe('W trakcie');
  });
  it('wiersz usunięty z chmury zostaje przywrócony z telefonu', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    server.tables.points.clear();
    await updatePoint(repo, repo.getPoint(p.id)!, { name: 'Odtworzony' });
    await engine.sync();
    expect(server.points()[0].name).toBe('Odtworzony');
  });
});

describe('pobieranie', () => {
  it('świeże urządzenie pobiera wszystko', async () => {
    const { repo, engine, server } = await setup();
    const p = await point(repo);
    await addVisit(repo, vd(p.id));
    await engine.sync();
    repo.db.close();
    freshIdb();
    const repo2 = await repoFor();
    await new SyncEngine(repo2, server).sync();
    expect(repo2.getSnapshot().points).toHaveLength(1);
    expect(repo2.getSnapshot().statuses.get(p.id)).toBe('posted');
    expect(pending(repo2)).toBe(0);
  });
  it('dzieli duże pobieranie na strony', async () => {
    const { repo, engine, server } = await setup();
    for (let i = 0; i < 1203; i++) {
      server.tables.points.set(`${USER}:${i}`, {
        user_id: USER, id: `id-${i}`, name: `p${i}`, place_type: 'other', locality: '', lat: 50, lng: 20, source: 'manual',
        note: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', server_rev: 1,
        server_updated_at: new Date(1_600_000_000_000 + i).toISOString(), osm: null, address: null, region: null,
        board_lat: null, board_lng: null, source_ref: null, archived_at: null, archive_reason: null,
      });
    }
    await engine.sync();
    expect(repo.getSnapshot().points).toHaveLength(1203);
  });
  it('pobranie nie nadpisuje niewysłanej zmiany', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    server.remoteEdit('points', p.id, { name: 'Z chmury', updated_at: '2020-01-01T00:00:00.000Z' });
    await updatePoint(repo, repo.getPoint(p.id)!, { name: 'Z telefonu' });
    await engine.sync();
    expect(repo.getPoint(p.id)!.name).toBe('Z telefonu');
    expect(server.points()[0].name).toBe('Z telefonu');
    expect(repo.getSnapshot().conflicts.map((c) => (c.version as { name: string }).name)).toEqual(['Z chmury']);
  });
  it('konflikt: nowsza z chmury wygrywa, wersja z telefonu zachowana', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    await updatePoint(repo, repo.getPoint(p.id)!, { note: 'moja notatka' });
    server.remoteEdit('points', p.id, { name: 'Nowsza', updated_at: '2099-01-01T00:00:00.000Z' });
    await engine.sync();
    expect(repo.getPoint(p.id)!.name).toBe('Nowsza');
    expect(pending(repo)).toBe(0);
    const [c] = repo.getSnapshot().conflicts;
    expect(c.origin).toBe('device');
    expect((c.version as { note: string }).note).toBe('moja notatka');
  });
  it('ta sama treść z dwóch urządzeń to nie konflikt', async () => {
    const { server, repo, engine } = await setup();
    const p = await point(repo);
    await engine.sync();
    await updatePoint(repo, repo.getPoint(p.id)!, { note: 'x' });
    server.remoteEdit('points', p.id, { note: 'x' });
    await engine.sync();
    expect(repo.getSnapshot().conflicts).toHaveLength(0);
    expect(pending(repo)).toBe(0);
  });
});

describe('izolacja kont', () => {
  it('dane w osobnych bazach', async () => {
    const a = await repoFor(USER);
    await point(a);
    const b = await repoFor(OTHER);
    expect(b.getSnapshot().points).toHaveLength(0);
    expect(b.pendingOps()).toHaveLength(0);
  });
  it('kolejka konta A nie idzie, gdy zalogowane jest konto B', async () => {
    const { server, repo, engine } = await setup();
    await point(repo);
    server.user = OTHER;
    await engine.sync();
    expect(engine.getState().phase).toBe('auth');
    expect(server.calls).toBe(0);
    expect(pending(repo)).toBe(1);
  });
  it('wylogowana sesja wstrzymuje wysyłkę, bez utraty kolejki', async () => {
    const { server, repo, engine } = await setup();
    await point(repo);
    server.user = null;
    await engine.sync();
    expect(engine.getState().phase).toBe('auth');
    expect(pending(repo)).toBe(1);
  });
  it('wiersz cudzego konta w odpowiedzi jest ignorowany', async () => {
    const { repo, engine, server } = await setup();
    const orig = server.list.bind(server);
    server.list = async (t, q) => [...(await orig(t, q)), {
      user_id: OTHER, id: 'obcy', name: 'Obcy', place_type: 'other', lat: 1, lng: 1, source: 'manual', created_at: '2026-01-01', updated_at: '2026-01-01',
      server_rev: 1, server_updated_at: '2026-01-01T00:00:00Z',
    }];
    await engine.sync();
    expect(repo.getSnapshot().points).toHaveLength(0);
  });
  it('odrzucony rekord zostaje w kolejce i nie blokuje pozostałych', async () => {
    const { server, repo, engine } = await setup();
    const a = await point(repo, { name: 'Zły' });
    const b = await point(repo, { name: 'Dobry' });
    const orig = server.insertIfAbsent.bind(server);
    const { BackendError } = await import('../../src/sync/backend');
    server.insertIfAbsent = async (t, r) => {
      if (r.id === a.id) throw new BackendError('Odrzucono', 'rejected');
      return orig(t, r);
    };
    await engine.sync();
    expect(engine.getState().phase).toBe('error');
    expect(repo.hasPending('point', a.id)).toBe(true);
    expect(repo.hasPending('point', b.id)).toBe(false);
  });
});
