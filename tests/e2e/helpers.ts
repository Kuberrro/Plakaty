import { expect, type BrowserContext, type Page } from '@playwright/test';

export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Nie obciążamy serwerów OSM w testach. */
export async function stubTiles(ctx: BrowserContext) {
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png' }));
}

export function autoDialogs(page: Page, answer = '') {
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answer) : d.accept()));
}

export async function enterDemo(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Tryb demonstracyjny' }).click();
  await expect(page.getByText('TRYB DEMONSTRACYJNY')).toBeVisible();
}

export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Widoki' }).getByRole('button', { name }).click();

export async function count(page: Page, key: string) {
  await tab(page, 'Raporty');
  return Number(await page.getByTestId(`count-${key}`).textContent());
}

export async function openFromList(page: Page, name: string | RegExp) {
  await tab(page, 'Lista');
  await page.getByRole('button', { name }).first().click();
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
type Row = Record<string, unknown>;

/**
 * Atrapa Supabase zachowująca się jak PostgREST + wyzwalacz + RLS.
 * Serwerowa logika SQL jest testowana osobno na prawdziwym Postgresie (npm run test:rls).
 */
export class MockSupabase {
  points = new Map<string, Row>();
  visits = new Map<string, Row>();
  users: Record<string, string> = { 'a@test.pl': USER_A, 'b@test.pl': USER_B };
  clock = Date.now();
  writes = 0;
  /** Zapis dotrze, ale odpowiedź zginie w sieci. */
  loseNextResponse: 'points' | 'visits' | null = null;

  private session(userId: string, email: string) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return {
      access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: userId, exp, role: 'authenticated' })}.sig`,
      token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${userId}`,
      user: { id: userId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    };
  }
  async attach(ctx: BrowserContext) {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    await ctx.route('http://supabase.test/auth/v1/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.url().includes('/token')) {
        const { email } = req.postDataJSON() as { email: string };
        const id = this.users[email];
        if (!id) return route.fulfill({ status: 400, headers: cors, json: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
        return route.fulfill({ status: 200, headers: cors, json: this.session(id, email) });
      }
      return route.fulfill({ status: 204, headers: cors });
    });
    await ctx.route('http://supabase.test/rest/v1/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = new URL(req.url());
      const name = url.pathname.split('/').pop() as 'points' | 'visits';
      const table = this[name];
      const token = req.headers().authorization?.split(' ')[1] ?? '';
      const uid = JSON.parse(Buffer.from(token.split('.')[1] ?? 'e30', 'base64url').toString()).sub as string | undefined;
      if (!uid) return route.fulfill({ status: 401, headers: cors, json: { code: '42501', message: 'denied' } });
      const eq = (k: string) => url.searchParams.get(k)?.replace(/^eq\./, '');
      const stamp = (row: Row, rev: number): Row => ({ ...row, server_rev: rev, server_updated_at: new Date((this.clock += 1000)).toISOString() });
      if (req.method() === 'POST') {
        this.writes++;
        const body = req.postDataJSON() as Row | Row[];
        const row = Array.isArray(body) ? body[0] : body;
        if (row.user_id !== uid) return route.fulfill({ status: 403, headers: cors, json: { code: '42501', message: 'RLS' } });
        const key = `${uid}:${row.id}`;
        if (table.has(key)) return route.fulfill({ status: 201, headers: cors, json: [] });
        const stored = stamp(row, 1);
        table.set(key, stored);
        if (this.loseNextResponse === name) { this.loseNextResponse = null; return route.abort('connectionreset'); }
        return route.fulfill({ status: 201, headers: cors, json: [stored] });
      }
      if (req.method() === 'PATCH') {
        this.writes++;
        const key = `${uid}:${eq('id')}`;
        const cur = table.get(key);
        if (!cur || String(cur.server_rev) !== eq('server_rev')) return route.fulfill({ status: 200, headers: cors, json: [] });
        const stored = stamp({ ...cur, ...(req.postDataJSON() as Row) }, (cur.server_rev as number) + 1);
        table.set(key, stored);
        return route.fulfill({ status: 200, headers: cors, json: [stored] });
      }
      let rows = [...table.values()].filter((r) => r.user_id === uid);
      const id = eq('id');
      if (id) rows = rows.filter((r) => r.id === id);
      const since = url.searchParams.get('server_updated_at')?.replace(/^gt\./, '');
      if (since) rows = rows.filter((r) => Date.parse(r.server_updated_at as string) > Date.parse(since));
      const single = (req.headers().accept ?? '').includes('vnd.pgrst.object');
      return route.fulfill({ status: 200, headers: cors, json: single ? rows[0] ?? null : rows });
    });
  }
}

export async function login(page: Page, email: string) {
  await page.goto('./');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Hasło').fill('testowe-haslo');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByTestId('statusbar')).toBeVisible();
}
