#!/usr/bin/env node
// Test dostępu na PRAWDZIWYM projekcie Supabase. Instrukcja: docs/WDROZENIE.md, krok 11.
// Używa wyłącznie klucza publishable i dwóch testowych kont; tworzy jeden punkt i po sobie sprząta.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Brak zmiennej ${k}`); process.exit(2); } return v; };
const url = env('SUPABASE_URL'), key = env('SUPABASE_PUBLISHABLE_KEY');
if (key.startsWith('sb_secret_')) { console.error('Użyj klucza publishable, nie secret.'); process.exit(2); }

const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(email, password) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Logowanie ${email}: ${error.message}`);
  return { c, id: data.user.id };
}
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? '  ok ' : ' BŁĄD'} ${name}${ok ? '' : ` -> ${JSON.stringify(detail)}`}`); };

const a = await signIn(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD'));
const b = await signIn(env('TEST_B_EMAIL'), env('TEST_B_PASSWORD'));
const pointId = randomUUID(), visitId = randomUUID(), op = randomUUID(), now = new Date().toISOString();
const point = { user_id: a.id, id: pointId, name: 'Test RLS', place_type: 'other', lat: 50, lng: 20, source: 'manual', created_at: now, updated_at: now, last_op_id: op };
const visit = { user_id: b.id, id: visitId, point_id: pointId, visited_at: now, outcome: 'posted', created_at: now, updated_at: now, last_op_id: op };

try {
  const ins = await a.c.from('points').insert(point).select();
  check('właściciel zapisuje punkt', !ins.error && ins.data?.length === 1, ins.error);
  const anon = await client().from('points').select('*').eq('id', pointId);
  check('niezalogowany nic nie odczyta', !!anon.error || anon.data?.length === 0, anon);
  const anonV = await client().from('point_status').select('*');
  check('widok niedostępny bez logowania', !!anonV.error || anonV.data?.length === 0, anonV);
  const read = await b.c.from('points').select('*').eq('id', pointId);
  check('drugie konto nie odczyta', read.data?.length === 0, read);
  const upd = await b.c.from('points').update({ name: 'x' }).eq('id', pointId).select();
  check('drugie konto nie zmieni', upd.data?.length === 0, upd);
  const del = await b.c.from('points').delete().eq('id', pointId).select();
  check('drugie konto nie usunie', del.data?.length === 0, del);
  const steal = await b.c.from('visits').insert(visit);
  check('nie można podpiąć wizyty do cudzego punktu', !!steal.error, steal);
  const forge = await b.c.from('points').insert({ ...point, id: randomUUID() });
  check('nie można zapisać danych jako inne konto', !!forge.error, forge);
  const still = await a.c.from('points').select('name').eq('id', pointId).single();
  check('dane właściciela nietknięte', still.data?.name === 'Test RLS', still);
} finally {
  await a.c.from('points').delete().eq('id', pointId);
}
console.log(failed ? `\nBłędów: ${failed}` : '\nWszystkie kontrole zaliczone.');
process.exit(failed ? 1 : 0);
