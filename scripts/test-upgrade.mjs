#!/usr/bin/env node
// Sprawdza, że aktualizacja 0002 na bazie z danymi wersji 1.0 niczego nie zmienia ani nie usuwa.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const PG_DIRS = ['/Library/PostgreSQL/17/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@14/bin', '/usr/local/bin', '/usr/bin'];
const bin = (n) => { for (const d of PG_DIRS) if (existsSync(join(d, n))) return join(d, n); throw new Error(`Brak programu ${n}`); };
const PORT = 54331;
const dir = mkdtempSync(join(tmpdir(), 'plakaty-upg-'));
execFileSync(bin('initdb'), ['-D', join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
const server = spawn(bin('postgres'), ['-D', join(dir, 'data'), '-p', String(PORT), '-k', dir, '-c', 'listen_addresses=127.0.0.1'], { stdio: 'ignore' });
let db;
for (let i = 0; ; i++) {
  db = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
  try { await db.connect(); break; } catch (e) { if (i > 50) throw e; await new Promise((r) => setTimeout(r, 100)); }
}
const snap = async () => JSON.stringify((await db.query(`
  select (select json_agg(t order by id) from (select id,name,place_type,lat,lng,server_rev,server_updated_at,updated_at from public.points) t) p,
         (select json_agg(t order by id) from (select id,point_id,outcome,poster_count,server_rev from public.visits) t) v`)).rows[0]);
let ok = true;
try {
  await db.query(readFileSync('tests/rls/emulate_supabase.sql', 'utf8'));
  await db.query(readFileSync('supabase/migrations/0001_schema.sql', 'utf8'));
  await db.query(readFileSync('tests/rls/upgrade_check.sql', 'utf8'));
  const before = await snap();
  for (const f of ['0002_kosz_i_rodzaje.sql', '0002_kosz_i_rodzaje.sql']) await db.query(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  const after = await snap();
  const counts = (await db.query('select (select count(*) from public.points) p, (select count(*) from public.visits) v, (select count(*) from public.points where deleted_at is not null) d')).rows[0];
  ok = before === after && counts.p === '200' && counts.v === '200' && counts.d === '0';
  console.log(`Punkty: ${counts.p}, wizyty: ${counts.v}, w koszu: ${counts.d}. Dane identyczne przed i po aktualizacji (także wersje i daty): ${before === after}.`);
} finally {
  await db.end().catch(() => {});
  server.kill('SIGINT');
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
}
console.log(ok ? 'Aktualizacja bezpieczna.' : 'BŁĄD: aktualizacja zmieniła dane!');
process.exitCode = ok ? 0 : 1;
