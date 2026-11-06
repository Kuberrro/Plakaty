import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

export function configProblem(k = key): string | null {
  if (!k) return null;
  if (k.startsWith('sb_secret_')) return 'Skonfigurowano klucz SECRET zamiast publishable. Usuń go natychmiast i wygeneruj nowy w Supabase.';
  return null;
}

export const supabaseConfigured = !!url && !!key && !url.includes('TWOJ-PROJEKT') && !key.includes('TWOJ_KLUCZ') && !configProblem();

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'plakaty-auth' } })
  : null;

const LAST_USER = 'plakaty-last-user';
export interface LastUser { userId: string; email: string }
export function rememberUser(u: LastUser) { localStorage.setItem(LAST_USER, JSON.stringify(u)); }
export function forgetUser() { localStorage.removeItem(LAST_USER); }
export function lastUser(): LastUser | null {
  try { return JSON.parse(localStorage.getItem(LAST_USER) ?? 'null'); } catch { return null; }
}
