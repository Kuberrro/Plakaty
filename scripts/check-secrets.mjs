#!/usr/bin/env node
// Blokuje build, jeśli w plikach wynikowych znajdzie się klucz sekretny.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const bad = [];
for (const file of walk(dir)) {
  const text = readFileSync(file, 'latin1');
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) bad.push(`${file}: klucz sb_secret_`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(m[1], 'base64url').toString()).role === 'service_role') bad.push(`${file}: klucz service_role`); } catch { /* inny token */ }
  }
}
if (bad.length) { console.error('ZNALEZIONO SEKRETY W BUILDZIE:\n' + bad.join('\n')); process.exit(1); }
console.log('Kontrola sekretów: czysto.');
