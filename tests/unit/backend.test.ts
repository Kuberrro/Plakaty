import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { BackendError, supabaseBackend } from '../../src/sync/backend';
import { configProblem } from '../../src/auth/client';

/** Prawdziwy klient supabase-js z podmienioną siecią: sprawdzamy dokładne żądania i obsługę odpowiedzi. */
function setup(respond: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const client = createClient('https://x.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (async (input: string, init: RequestInit) => { const url = new URL(input); calls.push({ url, init }); return respond(url, init); }) as typeof fetch },
  });
  return { b: supabaseBackend(client), calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const row = { user_id: 'u', id: 'i', name: 'n' };
const header = (c: { init: RequestInit }, n: string) => new Headers(c.init.headers).get(n);

describe('adapter supabase-js', () => {
  it('wstawienie: ignoruje duplikaty po (user_id,id) i prosi o zwrot wiersza', async () => {
    const { b, calls } = setup(() => json([{ ...row, server_rev: 1 }], 201));
    expect(await b.insertIfAbsent('points', row)).toMatchObject({ server_rev: 1 });
    const c = calls[0];
    expect(c.url.pathname).toBe('/rest/v1/points');
    expect(c.init.method).toBe('POST');
    expect(c.url.searchParams.get('on_conflict')).toBe('user_id,id');
    expect(header(c, 'Prefer')).toContain('resolution=ignore-duplicates');
    expect(header(c, 'Prefer')).toContain('return=representation');
  });
  it('wstawienie: pusta odpowiedź znaczy „już istniał”', async () => {
    const { b } = setup(() => json([], 201));
    expect(await b.insertIfAbsent('points', row)).toBeNull();
  });
  it('aktualizacja: warunek na wersję i właściciela', async () => {
    const { b, calls } = setup(() => json([{ ...row, server_rev: 4 }]));
    await b.updateIfRev('visits', row, 3);
    const c = calls[0];
    expect(c.init.method).toBe('PATCH');
    expect(c.url.pathname).toBe('/rest/v1/visits');
    expect(c.url.searchParams.get('server_rev')).toBe('eq.3');
    expect(c.url.searchParams.get('user_id')).toBe('eq.u');
    expect(c.url.searchParams.get('id')).toBe('eq.i');
  });
  it('lista: filtr czasu, stała kolejność, stronicowanie', async () => {
    const { b, calls } = setup(() => json([]));
    await b.list('points', { since: '2026-01-01T00:00:00.000Z', offset: 500, limit: 500 });
    const c = calls[0];
    expect(c.url.searchParams.get('server_updated_at')).toBe('gt.2026-01-01T00:00:00.000Z');
    expect(c.url.searchParams.get('order')).toBe('server_updated_at.asc,id.asc');
    expect(c.url.searchParams.get('offset')).toBe('500');
    expect(c.url.searchParams.get('limit')).toBe('500');
  });
  it.each([
    [401, { code: 'PGRST303', message: 'JWT expired' }, 'auth'],
    [403, { code: '42501', message: 'RLS' }, 'rejected'],
    [409, { code: '23503', message: 'FK' }, 'rejected'],
    [400, { code: '23514', message: 'check' }, 'rejected'],
    [503, { message: 'down' }, 'network'],
    [429, { message: 'slow' }, 'network'],
  ])('klasyfikacja błędu HTTP %i', async (status, body, kind) => {
    const { b } = setup(() => json(body, status));
    await expect(b.insertIfAbsent('points', row)).rejects.toMatchObject({ kind });
  });
  it('wyjątek sieci to błąd połączenia, nie odrzucenie', async () => {
    const client = createClient('https://x.supabase.co', 'k', {
      auth: { persistSession: false },
      global: { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch },
    });
    const insert = supabaseBackend(client).insertIfAbsent('points', row); // POST: bez wbudowanych ponowień klienta
    await expect(insert).rejects.toBeInstanceOf(BackendError);
    await expect(insert).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('ochrona kluczy', () => {
  it('klucz secret jest odrzucany', () => {
    expect(configProblem('sb_secret_abc')).toBeTruthy();
    expect(configProblem('sb_publishable_abc')).toBeNull();
  });
});
