import { useMemo, useState } from 'react';
import { bulkUpdatePoints, trashPoints, unarchivePoints, untrashPoints } from '../data/actions';
import { applyFilters, distanceTo, inScope, regionsOf, type Filters, type ListScope } from '../lib/filters';
import { formatDistance } from '../lib/geo';
import { PLACE_LABEL, PLACE_TYPES, STATUS_LABEL, STATUS_SYMBOL, type PlaceType, type Point } from '../lib/types';
import { FilterBar } from './FilterBar';
import { useApp, useSnapshot } from './hooks';

const SCOPE_LABEL: Record<ListScope, string> = { active: 'Aktywne punkty', archived: 'Archiwum', trash: 'Kosz' };

export function ListView({ filters, setFilters, onQuickAdd }: { filters: Filters; setFilters: (f: Filters) => void; onQuickAdd: () => void }) {
  const { openPoint, location, repo, toast } = useApp();
  const { points, statuses } = useSnapshot();
  const [sort, setSort] = useState<'name' | 'distance'>('name');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = applyFilters(points, statuses, filters);
    const pos = location.pos;
    if (sort === 'distance' && pos) return [...list].sort((a, b) => distanceTo(pos, a) - distanceTo(pos, b));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [points, statuses, filters, sort, location.pos]);

  const chosen = rows.filter((p) => selected.has(p.id));
  const scopeTotal = points.filter((p) => inScope(p, filters.scope)).length;

  async function nearest() {
    setFilters({ ...filters, statuses: ['todo', 'return'], scope: 'active' });
    if (await location.request()) setSort('distance');
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); toast(`${label}: ${chosen.length}`); setSelected(new Set()); }
    catch { toast('Nie udało się zapisać. Nic nie zostało zmienione.', 'error'); }
    finally { setBusy(false); }
  }

  const bulkTrash = () => {
    if (window.confirm(`Przenieść do kosza: ${chosen.length}? Znikną z mapy, listy, raportów i eksportów. Możesz je przywrócić z kosza.`)) {
      void run('Przeniesiono do kosza', () => trashPoints(repo, chosen));
    }
  };
  const bulkRegion = () => {
    const r = window.prompt(`Rejon dla zaznaczonych (${chosen.length}). Puste pole usuwa rejon. Istniejące: ${regionsOf(points).join(', ') || 'brak'}`, '');
    if (r !== null) void run('Zmieniono rejon', () => bulkUpdatePoints(repo, chosen, { region: r.trim() || null }));
  };
  const bulkType = (t: PlaceType) => void run('Zmieniono rodzaj', () => bulkUpdatePoints(repo, chosen, { placeType: t }));

  return (
    <div className="scroll pad stack">
      {filters.scope === 'active' && <button className="btn primary" onClick={onQuickAdd}>＋ Plakat w tym miejscu</button>}
      <FilterBar value={filters} onChange={setFilters} />
      <div className="row wrap">
        <select aria-label="Pokaż" value={filters.scope} onChange={(e) => { setFilters({ ...filters, scope: e.target.value as ListScope }); setSelected(new Set()); }}>
          {(Object.keys(SCOPE_LABEL) as ListScope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
        </select>
        <button className={`btn tiny ${selecting ? 'primary' : ''}`} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>
          {selecting ? 'Zakończ zaznaczanie' : 'Zaznacz wiele'}
        </button>
      </div>
      {!selecting && filters.scope === 'active' && (
        <div className="row wrap">
          <button className="btn" disabled={location.busy} onClick={nearest}>{location.busy ? 'Szukam…' : 'Najbliższe niewykonane'}</button>
          <select aria-label="Sortowanie" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">Sortuj: nazwa</option>
            <option value="distance" disabled={!location.pos}>Sortuj: odległość w linii prostej</option>
          </select>
        </div>
      )}
      {selecting && (
        <div className="select-bar stack" data-testid="select-bar">
          <div className="row wrap">
            <b>Zaznaczono: {chosen.length}</b>
            <button className="btn tiny" onClick={() => setSelected(new Set(rows.map((p) => p.id)))}>Zaznacz wszystkie widoczne ({rows.length})</button>
            <button className="btn tiny" disabled={!chosen.length} onClick={() => setSelected(new Set())}>Odznacz</button>
          </div>
          <div className="row wrap">
            {filters.scope === 'trash' ? (
              <button className="btn tiny primary" disabled={!chosen.length || busy} onClick={() => void run('Przywrócono', () => untrashPoints(repo, chosen))}>Przywróć z kosza</button>
            ) : (
              <>
                {filters.scope === 'archived' && (
                  <button className="btn tiny" disabled={!chosen.length || busy} onClick={() => void run('Przywrócono z archiwum', () => unarchivePoints(repo, chosen))}>Przywróć z archiwum</button>
                )}
                <button className="btn tiny" disabled={!chosen.length || busy} onClick={bulkRegion}>Ustaw rejon</button>
                <select className="tiny-select" aria-label="Zmień rodzaj zaznaczonych" value="" disabled={!chosen.length || busy} onChange={(e) => e.target.value && bulkType(e.target.value as PlaceType)}>
                  <option value="">Zmień rodzaj…</option>
                  {PLACE_TYPES.map((t) => <option key={t} value={t}>{PLACE_LABEL[t]}</option>)}
                </select>
                <button className="btn tiny danger" disabled={!chosen.length || busy} onClick={bulkTrash}>Usuń do kosza</button>
              </>
            )}
          </div>
        </div>
      )}
      {location.error && <p className="notice small" role="status">{location.error}</p>}
      <p className="small muted">{SCOPE_LABEL[filters.scope]}: {rows.length} z {scopeTotal}</p>
      {filters.scope === 'trash' && <p className="small muted">Punkty w koszu nie liczą się w raportach i eksportach. Ich historia jest zachowana.</p>}
      <ul className="point-list">
        {rows.map((p: Point) => {
          const s = statuses.get(p.id) ?? 'todo';
          return (
            <li key={p.id}>
              <button onClick={() => (selecting ? toggle(p.id) : openPoint(p.id))} aria-pressed={selecting ? selected.has(p.id) : undefined}>
                {selecting && <input type="checkbox" tabIndex={-1} readOnly checked={selected.has(p.id)} aria-hidden />}
                <span className={`pin mini pin-${s}`} aria-hidden>{STATUS_SYMBOL[s]}</span>
                <span className="grow">
                  <strong>{p.name}</strong>
                  <span className="small muted block">
                    {STATUS_LABEL[s]} · {PLACE_LABEL[p.placeType] ?? p.placeType}{p.locality ? ` · ${p.locality}` : ''}{p.region ? ` · ${p.region}` : ''}
                  </span>
                  {location.pos && <span className="small block">{formatDistance(distanceTo(location.pos, p))}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!rows.length && <p className="muted">Brak punktów w tym widoku.</p>}
    </div>
  );
}
