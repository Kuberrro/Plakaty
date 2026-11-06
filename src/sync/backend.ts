import type { SupabaseClient } from '@supabase/supabase-js';
import type { Row } from './mapping';

export type Table = 'points' | 'visits';

export class BackendError extends Error {
  constructor(message: string, readonly kind: 'network' | 'auth' | 'rejected') { super(message); }
}

export interface PageQuery { since: string | null; offset: number; limit: number }

/** Cienka warstwa nad API. Silnik synchronizacji zna tylko ten interfejs. */
export interface SyncBackend {
  currentUserId(): Promise<string | null>;
  /** Wstawia, jeśli wiersza nie ma. Zwraca wstawiony wiersz albo null, gdy już istniał. */
  insertIfAbsent(table: Table, row: Row): Promise<Row | null>;
  /** Aktualizuje tylko przy zgodnej wersji. null = wersja się różni lub brak wiersza. */
  updateIfRev(table: Table, row: Row, rev: number): Promise<Row | null>;
  get(table: Table, userId: string, id: string): Promise<Row | null>;
  list(table: Table, q: PageQuery): Promise<Row[]>;
}

function classify(e: { message?: string; code?: string; status?: number } | null, status?: number): BackendError {
  const message = e?.message ?? 'Nieznany błąd';
  if (status === 401 || e?.code === 'PGRST301' || e?.code === 'PGRST303') return new BackendError('Sesja wygasła. Zaloguj się ponownie.', 'auth');
  if (status === 403 || e?.code === '42501') return new BackendError(`Odmowa dostępu: ${message}`, 'rejected');
  if (!status || status === 408 || status === 429 || status >= 500 || /fetch|network/i.test(message)) {
    return new BackendError(`Błąd połączenia: ${message}`, 'network');
  }
  return new BackendError(message, 'rejected');
}

export function supabaseBackend(client: SupabaseClient): SyncBackend {
  return {
    async currentUserId() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async insertIfAbsent(table, row) {
      const { data, error, status } = await client.from(table)
        .upsert(row, { onConflict: 'user_id,id', ignoreDuplicates: true }).select();
      if (error) throw classify(error, status);
      return (data?.[0] as Row | undefined) ?? null;
    },
    async updateIfRev(table, row, rev) {
      const { data, error, status } = await client.from(table).update(row)
        .eq('user_id', row.user_id as string).eq('id', row.id as string).eq('server_rev', rev).select();
      if (error) throw classify(error, status);
      return (data?.[0] as Row | undefined) ?? null;
    },
    async get(table, userId, id) {
      const { data, error, status } = await client.from(table).select('*').eq('user_id', userId).eq('id', id).maybeSingle();
      if (error) throw classify(error, status);
      return (data as Row | null) ?? null;
    },
    async list(table, { since, offset, limit }) {
      let q = client.from(table).select('*');
      if (since) q = q.gt('server_updated_at', since);
      const { data, error, status } = await q
        .order('server_updated_at', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw classify(error, status);
      return (data ?? []) as Row[];
    },
  };
}
