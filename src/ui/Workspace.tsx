import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../auth/client';
import { clearDemo, seedDemo } from '../data/demo';
import { openScopeDb, scopeOwnerId, type Scope } from '../data/db';
import { Repository } from '../data/repository';
import { EMPTY_FILTERS, type Filters } from '../lib/filters';
import { supabaseBackend } from '../sync/backend';
import { SyncEngine } from '../sync/engine';
import { ActiveTargetCard } from './ActiveTargetCard';
import { BackupReminder } from './BackupReminder';
import { FindView } from './FindView';
import { Ctx, useGeo, type AppCtx } from './hooks';
import { ListView } from './ListView';
import { MapView } from './MapView';
import { PointSheet } from './PointSheet';
import { ReportsView } from './ReportsView';
import { SettingsView } from './SettingsView';
import { StatusBar } from './StatusBar';

const TABS = [
  ['mapa', 'Mapa', '🗺'], ['lista', 'Lista', '☰'], ['znajdz', 'Znajdź', '🔍'], ['raporty', 'Raporty', '📊'], ['ustawienia', 'Ustawienia', '⚙'],
] as const;
type Tab = (typeof TABS)[number][0];

function useTab(): [Tab, (t: Tab) => void] {
  const read = (): Tab => {
    const h = location.hash.replace(/^#\/?/, '');
    return (TABS.find((t) => t[0] === h)?.[0] ?? 'mapa') as Tab;
  };
  const [tab, set] = useState<Tab>(read);
  useEffect(() => {
    const on = () => set(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return [tab, (t) => { location.hash = `/${t}`; }];
}

export function Workspace({ scope, onLeave }: { scope: Scope; onLeave: () => Promise<void> }) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const location = useGeo();
  const [tab, setTab] = useTab();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    (async () => {
      try {
        const db = await openScopeDb(scope);
        const track = scope.kind === 'user';
        const r = await new Repository(db, scopeOwnerId(scope), track).load();
        if (scope.kind === 'demo') await seedDemo(r);
        if (!alive) { db.close(); return; }
        let eng: SyncEngine | null = null;
        if (track && supabase) {
          eng = new SyncEngine(r, supabaseBackend(supabase));
          await eng.init();
          const e = eng;
          let timer: ReturnType<typeof setTimeout>;
          const later = () => { clearTimeout(timer); timer = setTimeout(() => { if (navigator.onLine) void e.sync(); }, 1500); };
          const now = () => { if (navigator.onLine) void e.sync(); };
          const visible = () => { if (document.visibilityState === 'visible') now(); };
          r.onLocalChange = later;
          addEventListener('online', now);
          document.addEventListener('visibilitychange', visible);
          cleanup = () => {
            clearTimeout(timer);
            r.onLocalChange = null;
            removeEventListener('online', now);
            document.removeEventListener('visibilitychange', visible);
          };
          now();
        }
        const prevCleanup = cleanup;
        cleanup = () => { prevCleanup(); db.close(); };
        setRepo(r);
        setEngine(eng);
      } catch (e) {
        if (alive) setFatal((e as Error).message || 'Nie można otworzyć pamięci urządzenia');
      }
    })();
    return () => { alive = false; cleanup(); };
  }, [scope]);

  const toast = useCallback<AppCtx['toast']>((text, kind = 'ok') => {
    setToastMsg({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), kind === 'error' ? 7000 : 3000);
  }, []);

  const ctx = useMemo<AppCtx | null>(
    () => (repo ? { repo, engine, scope, toast, openPoint: setOpenId, location } : null),
    [repo, engine, scope, toast, location],
  );

  if (fatal) {
    return (
      <div className="center-screen stack">
        <p className="error-text" role="alert">Nie można otworzyć lokalnej bazy danych: {fatal}</p>
        <p>Dane nie zostały usunięte. Zamknij aplikację i otwórz ją ponownie.</p>
      </div>
    );
  }
  if (!ctx) return <div className="center-screen">Ładowanie danych…</div>;

  const reachedPoint = (id: string) => { setOpenId(id); };
  const leave = async () => {
    await onLeave();
  };
  const resetDemo = async () => {
    repo!.db.close();
    await clearDemo();
    window.location.reload();
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        {scope.kind === 'demo' && (
          <div className="demo-banner" role="status">TRYB DEMONSTRACYJNY: dane fikcyjne</div>
        )}
        <StatusBar />
        <ActiveTargetCard />
        <BackupReminder onOpen={() => setTab('ustawienia')} />
        <main className="view">
          {tab === 'mapa' && <MapView filters={filters} setFilters={setFilters} />}
          {tab === 'lista' && <ListView filters={filters} setFilters={setFilters} />}
          {tab === 'znajdz' && <FindView />}
          {tab === 'raporty' && <ReportsView />}
          {tab === 'ustawienia' && <SettingsView onLeave={leave} onResetDemo={resetDemo} onShowArchive={() => { setFilters({ ...EMPTY_FILTERS, archived: true }); setTab('lista'); }} />}
        </main>
        <nav className="tabbar" aria-label="Widoki">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <span aria-hidden>{icon}</span>{label}
            </button>
          ))}
        </nav>
        {openId && <PointSheet id={openId} onClose={() => setOpenId(null)} onOpenOther={reachedPoint} />}
        {toastMsg && <div className={`toast ${toastMsg.kind}`} role="status">{toastMsg.text}</div>}
      </div>
    </Ctx.Provider>
  );
}
