import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addVisit, archivePoint, cancelNavigation, cancelVisit, correctVisit, defaultPosters, startNavigation,
} from '../../src/data/actions';
import { freshIdb, point, repoFor } from './helpers';

beforeEach(freshIdb);
const visit = { visitedAt: '2026-05-01T10:00:00.000Z', outcome: 'posted' as const, posterCount: 1, note: '', gps: null };

describe('aktywny cel i wizyty', () => {
  it('Nawiguj nie tworzy wizyty i przetrwa ponowne otwarcie', async () => {
    let repo = await repoFor();
    const p = await point(repo);
    await startNavigation(repo, p);
    expect(repo.getSnapshot().visits).toHaveLength(0);
    expect(repo.getSnapshot().statuses.get(p.id)).toBe('todo');
    repo.db.close();
    repo = await repoFor();
    expect(repo.getSnapshot().activeTarget?.pointId).toBe(p.id);
  });
  it('nawigacja prowadzi do tablicy, gdy jest zapisana', async () => {
    const repo = await repoFor();
    const p = await point(repo, { boardLat: 50.5, boardLng: 19.5 });
    expect(await startNavigation(repo, p)).toMatchObject({ lat: 50.5, lng: 19.5, kind: 'board' });
  });
  it('wybór innego celu nie tworzy wizyty poprzedniemu', async () => {
    const repo = await repoFor();
    const a = await point(repo); const b = await point(repo, { name: 'B' });
    await startNavigation(repo, a);
    await startNavigation(repo, b);
    expect(repo.getSnapshot().activeTarget?.pointId).toBe(b.id);
    expect(repo.getSnapshot().visits).toHaveLength(0);
  });
  it('anulowanie dojazdu nic nie odwiedza', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await startNavigation(repo, p);
    await cancelNavigation(repo);
    expect(repo.getSnapshot().activeTarget).toBeNull();
    expect(repo.getSnapshot().statuses.get(p.id)).toBe('todo');
  });
  it('wizyta w aktywnym punkcie kończy dojazd, w innym nie', async () => {
    const repo = await repoFor();
    const a = await point(repo); const b = await point(repo, { name: 'B' });
    await startNavigation(repo, a);
    await addVisit(repo, { ...visit, pointId: b.id });
    expect(repo.getSnapshot().activeTarget?.pointId).toBe(a.id);
    await addVisit(repo, { ...visit, pointId: a.id });
    expect(repo.getSnapshot().activeTarget).toBeNull();
  });
  it('domyślne liczby plakatów', () => {
    expect(defaultPosters('posted')).toBe(1);
    expect(defaultPosters('return')).toBe(0);
    expect(defaultPosters('impossible')).toBe(0);
  });
  it('korekta zachowuje poprzednie wartości i zmienia status', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    const v = await addVisit(repo, { ...visit, pointId: p.id });
    await correctVisit(repo, v, { visitedAt: v.visitedAt, outcome: 'return', posterCount: 0, note: 'pomyłka' });
    const got = repo.getVisit(v.id)!;
    expect(got.corrections).toHaveLength(1);
    expect(got.corrections[0].before.outcome).toBe('posted');
    expect(repo.getSnapshot().statuses.get(p.id)).toBe('return');
  });
  it('anulowanie zostawia rekord z informacją i cofa status', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    const v = await addVisit(repo, { ...visit, pointId: p.id });
    await cancelVisit(repo, v, 'zły punkt');
    expect(repo.getSnapshot().visits).toHaveLength(1);
    expect(repo.getVisit(v.id)!.cancelReason).toBe('zły punkt');
    expect(repo.getSnapshot().statuses.get(p.id)).toBe('todo');
  });
  it('archiwizacja nie usuwa punktu ani wizyt', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await addVisit(repo, { ...visit, pointId: p.id });
    await archivePoint(repo, p, null);
    expect(repo.getSnapshot().points).toHaveLength(1);
    expect(repo.getSnapshot().visits).toHaveLength(1);
  });
  it('niedozwolona liczba plakatów jest odrzucana', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await expect(addVisit(repo, { ...visit, pointId: p.id, posterCount: -1 })).rejects.toThrow();
    expect(repo.getSnapshot().visits).toHaveLength(0);
  });
});

describe('trwałość zapisu', () => {
  it('nieudana transakcja zgłasza błąd i nie zmienia stanu', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    const spy = vi.spyOn(repo.db, 'transaction').mockImplementation(() => { throw new Error('Dysk pełny'); });
    await expect(addVisit(repo, { ...visit, pointId: p.id })).rejects.toThrow('Dysk pełny');
    spy.mockRestore();
    expect(repo.getSnapshot().visits).toHaveLength(0);
    expect(repo.getSnapshot().outbox.size).toBe(1); // tylko sam punkt
  });
  it('dane i kolejka przetrwają ponowne otwarcie', async () => {
    let repo = await repoFor();
    const p = await point(repo);
    await addVisit(repo, { ...visit, pointId: p.id });
    repo.db.close();
    repo = await repoFor();
    expect(repo.getSnapshot().visits).toHaveLength(1);
    expect(repo.pendingOps().map((o) => o.entity)).toEqual(['point', 'visit']);
  });
  it('wiele edycji jednego rekordu = jeden wpis w kolejce', async () => {
    const repo = await repoFor();
    const p = await point(repo);
    await archivePoint(repo, p, null);
    await archivePoint(repo, repo.getPoint(p.id)!, 'x');
    expect(repo.pendingOps()).toHaveLength(1);
  });
});
