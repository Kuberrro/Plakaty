import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { addVisit, createManualPoint } from '../../src/data/actions';
import { openScopeDb } from '../../src/data/db';
import { Repository } from '../../src/data/repository';
import { supabaseBackend, type SyncBackend } from '../../src/sync/backend';
import { SyncEngine } from '../../src/sync/engine';

const { API_URL, JWT_SECRET, USER_A, USER_B } = process.env as Record<string, string>;
const b64 = (s: string) => Buffer.from(s).toString('base64url');
function jwt(sub: string) {
  const body = `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }))}`;
  return `${body}.${createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}
function client(sub: string | null): SupabaseClient {
  return createClient(API_URL, 'sb_publishable_test', {
    ...(sub ? { accessToken: async () => jwt(sub) } : {}),
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (!sub) headers.delete('Authorization');
        return fetch(String(input).replace('/rest/v1', ''), { ...init, headers });
      },
    },
  });
}
const backend = (sub: string): SyncBackend => ({ ...supabaseBackend(client(sub)), currentUserId: async () => sub });
async function device(sub: string) {
  const repo = await new Repository(await openScopeDb({ kind: 'user', userId: sub, email: 'x' }), sub, true).load();
  return { repo, engine: new SyncEngine(repo, backend(sub)) };
}
const draft = { name: 'Żółta remiza', placeType: 'fire_station' as const, locality: 'Łąka', address: null, region: 'Północ', lat: 50.1, lng: 19.9, boardLat: null, boardLng: null, note: '' };

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

describe('synchronizacja przez API', () => {
  it('wysyła, a świeże urządzenie odtwarza dane i status', async () => {
    const a = await device(USER_A);
    const p = await createManualPoint(a.repo, draft);
    await addVisit(a.repo, { pointId: p.id, visitedAt: '2026-05-01T10:00:00.000Z', outcome: 'posted', posterCount: 2, note: 'ą', gps: null });
    await a.engine.sync();
    expect(a.engine.getState()).toMatchObject({ phase: 'idle', message: null });
    globalThis.indexedDB = new IDBFactory();
    const fresh = await device(USER_A);
    await fresh.engine.sync();
    expect(fresh.repo.getSnapshot().statuses.get(p.id)).toBe('posted');
  });
  it('drugie konto i anonim nic nie dostają', async () => {
    const a = await device(USER_A);
    await createManualPoint(a.repo, { ...draft, name: 'Prywatny' });
    await a.engine.sync();
    expect((await client(USER_B).from('points').select('*').eq('name', 'Prywatny')).data).toEqual([]);
    expect((await client(null).from('points').select('*')).error?.code).toBe('42501');
  });
});
