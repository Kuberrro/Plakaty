#!/usr/bin/env node
// Test bezpieczeństwa na PRAWDZIWYM Postgresie w tymczasowym klastrze (nie dotyka innych baz).
// Środowisko Supabase jest emulowane (tests/rls/emulate_supabase.sql).
// Opcjonalnie: POSTGREST_BIN=/ścieżka/postgrest doda test synchronizacji przez API.
// Test na prawdziwym projekcie: npm run test:rls:live.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const PG_DIRS = ['/Library/PostgreSQL/17/bin', '/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@14/bin', '/usr/local/bin', '/usr/bin'];
const bin = (n) => { for (const d of PG_DIRS) if (existsSync(join(d, n))) return join(d, n); throw new Error(`Brak programu ${n}`); };
const PORT = 54329, API_PORT = 54330;
const JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = 'c0000000-0000-4000-8000-000000000001', P2 = 'c0000000-0000-4000-8000-000000000002';
const V1 = 'd0000000-0000-4000-8000-000000000001', OP = 'e0000000-0000-4000-8000-000000000001';

const dir = mkdtempSync(join(tmpdir(), 'plakaty-rls-'));
const data = join(dir, 'data');
execFileSync(bin('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
const server = spawn(bin('postgres'), ['-D', data, '-p', String(PORT), '-k', dir, '-c', 'listen_addresses=127.0.0.1'], { stdio: 'ignore' });
let api = null;
const stop = () => { api?.kill(); server.kill('SIGINT'); };

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? '  ok ' : ' BŁĄD'} ${name}${ok ? '' : ` -> ${detail}`}`); };

let db;
for (let i = 0; ; i++) {
  db = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
  try { await db.connect(); break; }
  catch (e) { if (i > 50) throw e; await new Promise((r) => setTimeout(r, 100)); }
}

/** Wykonuje SQL jako dana rola (jak żądanie z API); zwraca wiersze albo kod błędu. */
async function as(role, uid, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [role, uid ? JSON.stringify({ sub: uid, role }) : '']);
    const r = await db.query(sql, params);
    await db.query('commit');
    return { rows: r.rows, count: r.rowCount };
  } catch (e) {
    await db.query('rollback');
    return { error: e.code, message: e.message };
  }
}
const pointSql = (user, id) => `insert into public.points (user_id,id,name,place_type,lat,lng,source,created_at,updated_at,last_op_id)
  values ('${user}','${id}','Punkt','other',50,20,'manual',now(),now(),'${OP}')`;
const visitSql = (user, id, point) => `insert into public.visits (user_id,id,point_id,visited_at,outcome,created_at,updated_at,last_op_id)
  values ('${user}','${id}','${point}',now(),'posted',now(),now(),'${OP}')`;

try {
  await db.query(readFileSync('tests/rls/emulate_supabase.sql', 'utf8'));
  await db.query(`insert into auth.users values ('${A}'),('${B}')`);
  await db.query(readFileSync('supabase/migrations/0001_schema.sql', 'utf8'));
  console.log('Migracja wykonana na czystej bazie.');

  console.log('\nNiezalogowany:');
  await as('authenticated', A, pointSql(A, P1));
  await as('authenticated', A, visitSql(A, V1, P1));
  for (const t of ['points', 'visits', 'point_status']) {
    const r = await as('anon', null, `select * from public.${t}`);
    check(`nie odczyta ${t}`, r.error === '42501', JSON.stringify(r));
  }
  check('nie doda punktu', (await as('anon', null, pointSql(A, P2))).error === '42501');

  console.log('\nDrugie konto:');
  check('nie widzi punktów A', (await as('authenticated', B, 'select * from public.points')).rows?.length === 0);
  check('nie widzi wizyt A', (await as('authenticated', B, 'select * from public.visits')).rows?.length === 0);
  check('widok nie omija RLS', (await as('authenticated', B, 'select * from public.point_status')).rows?.length === 0);
  check('nie zmieni punktu A', (await as('authenticated', B, `update public.points set name='x' where id='${P1}'`)).count === 0);
  check('nie usunie punktu A', (await as('authenticated', B, `delete from public.points where id='${P1}'`)).count === 0);
  check('nie usunie wizyty A', (await as('authenticated', B, `delete from public.visits where id='${V1}'`)).count === 0);
  check('nie doda punktu jako A', (await as('authenticated', B, pointSql(A, P2))).error === '42501');
  check('nie doda wizyty jako A', (await as('authenticated', B, visitSql(A, 'd0000000-0000-4000-8000-000000000002', P1))).error === '42501');
  check('nie podepnie swojej wizyty pod punkt A', (await as('authenticated', B, visitSql(B, 'd0000000-0000-4000-8000-000000000003', P1))).error === '23503');
  check('A nie odda rekordu B', (await as('authenticated', A, `update public.points set user_id='${B}' where id='${P1}'`)).error === '42501');
  const after = await as('authenticated', A, `select name from public.points where id='${P1}'`);
  check('dane A nietknięte', after.rows?.[0]?.name === 'Punkt');
  check('ten sam UUID na dwóch kontach bez kolizji', !(await as('authenticated', B, pointSql(B, P1))).error);
  check('każde konto widzi tylko swój wiersz', (await as('authenticated', B, 'select * from public.points')).rows?.length === 1);

  console.log('\nWalidacja i wersje:');
  const st = await as('authenticated', A, `select status from public.point_status where point_id='${P1}'`);
  check('widok liczy status', st.rows?.[0]?.status === 'posted', JSON.stringify(st));
  const spoof = await as('authenticated', A, `update public.points set name='y', server_rev=999 where id='${P1}' returning server_rev`);
  check('klient nie sfałszuje wersji', String(spoof.rows?.[0]?.server_rev) === '2', JSON.stringify(spoof));
  // Warunkowa aktualizacja i wstawienie bez nadpisania: te same operacje, których używa synchronizacja.
  const up = await as('authenticated', A, `update public.points set name='z' where id='${P1}' and server_rev=1`);
  check('aktualizacja na starej wersji nic nie zmienia', up.count === 0, JSON.stringify(up));
  const ins = await as('authenticated', A, `${pointSql(A, P1)} on conflict (user_id,id) do nothing returning id`);
  check('ponowne wstawienie jest ignorowane', ins.count === 0, JSON.stringify(ins));
  check('wynik spoza listy odrzucony', (await as('authenticated', A, `update public.visits set outcome='x' where id='${V1}'`)).error === '23514');
  check('szerokość > 90 odrzucona', (await as('authenticated', A, `update public.points set lat=91 where id='${P1}'`)).error === '23514');
  check('pusta nazwa odrzucona', (await as('authenticated', A, `update public.points set name='  ' where id='${P1}'`)).error === '23514');
  check('tablica bez drugiej współrzędnej odrzucona', (await as('authenticated', A, `update public.points set board_lat=50 where id='${P1}'`)).error === '23514');
  check('ujemne plakaty odrzucone', (await as('authenticated', A, `update public.visits set poster_count=-1 where id='${V1}'`)).error === '23514');
  check('właściciel może usunąć swoją wizytę', (await as('authenticated', A, `delete from public.visits where id='${V1}'`)).count === 1);

  const tables = await db.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'`);
  check('RLS włączone na wszystkich tabelach', tables.rows.length === 2 && tables.rows.every((r) => r.relrowsecurity));
  const policies = await db.query(`select tablename, count(*)::int c from pg_policies where schemaname='public' group by 1`);
  check('4 polityki na tabelę', policies.rows.every((r) => r.c === 4) && policies.rows.length === 2);

  const postgrest = process.env.POSTGREST_BIN;
  if (postgrest) {
    console.log('\nPostgREST + supabase-js (prawdziwe wywołania API):');
    await db.query(`truncate public.points cascade`);
    const conf = join(dir, 'pgrst.conf');
    writeFileSync(conf, `db-uri = "postgres://authenticator:test@127.0.0.1:${PORT}/postgres"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${JWT_SECRET}"\nserver-port = ${API_PORT}\nserver-host = "127.0.0.1"\n`);
    api = spawn(postgrest, [conf], { stdio: 'ignore' });
    for (let i = 0; ; i++) {
      try { if ((await fetch(`http://127.0.0.1:${API_PORT}/points`)).status) break; }
      catch { if (i > 50) throw new Error('PostgREST nie wystartował'); await new Promise((r) => setTimeout(r, 200)); }
    }
    const r = spawn('node_modules/.bin/vitest', ['run', '--config', 'vitest.integration.config.ts'], {
      stdio: 'inherit', env: { ...process.env, API_URL: `http://127.0.0.1:${API_PORT}`, JWT_SECRET, USER_A: A, USER_B: B },
    });
    const code = await new Promise((res) => r.on('close', res));
    check('testy integracyjne API', code === 0, `kod ${code}`);
  } else {
    console.log('\nPominięto test API: ustaw POSTGREST_BIN, aby go wykonać.');
  }
} finally {
  await db.end().catch(() => {});
  stop();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
}
console.log(`\nWynik: ${passed} zaliczonych, ${failed} błędów.`);
process.exitCode = failed ? 1 : 0;
