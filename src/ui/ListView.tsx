import { useMemo, useState } from 'react';
import { applyFilters, distanceTo, type Filters } from '../lib/filters';
import { formatDistance } from '../lib/geo';
import { STATUS_LABEL, STATUS_SYMBOL, type Point } from '../lib/types';
import { FilterBar } from './FilterBar';
import { useApp, useSnapshot } from './hooks';

export function ListView({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { openPoint, location } = useApp();
  const { points, statuses } = useSnapshot();
  const [sort, setSort] = useState<'name' | 'distance'>('name');

  const rows = useMemo(() => {
    const list = applyFilters(points, statuses, filters);
    const pos = location.pos;
    if (sort === 'distance' && pos) return [...list].sort((a, b) => distanceTo(pos, a) - distanceTo(pos, b));
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [points, statuses, filters, sort, location.pos]);

  async function nearest() {
    setFilters({ ...filters, statuses: ['todo', 'return'], archived: false });
    if (await location.request()) setSort('distance');
  }

  return (
    <div className="scroll pad stack">
      <FilterBar value={filters} onChange={setFilters} />
      <div className="row wrap">
        <button className="btn" disabled={location.busy} onClick={nearest}>{location.busy ? 'Szukam…' : 'Najbliższe niewykonane'}</button>
        <select aria-label="Sortowanie" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="name">Sortuj: nazwa</option>
          <option value="distance" disabled={!location.pos}>Sortuj: odległość w linii prostej</option>
        </select>
      </div>
      {location.error && <p className="notice small" role="status">{location.error}</p>}
      <p className="small muted">
        {filters.archived ? 'Archiwum: ' : ''}{rows.length} z {points.filter((p) => !!p.archivedAt === filters.archived).length} punktów
        {filters.archived && <> · <button className="linklike" onClick={() => setFilters({ ...filters, archived: false })}>wróć do aktywnych</button></>}
      </p>
      <ul className="point-list">
        {rows.map((p: Point) => {
          const s = statuses.get(p.id) ?? 'todo';
          return (
            <li key={p.id}>
              <button onClick={() => openPoint(p.id)}>
                <span className={`pin mini pin-${s}`} aria-hidden>{STATUS_SYMBOL[s]}</span>
                <span className="grow">
                  <strong>{p.name}</strong>
                  <span className="small muted block">
                    {STATUS_LABEL[s]}{p.locality ? ` · ${p.locality}` : ''}{p.region ? ` · ${p.region}` : ''}
                  </span>
                  {location.pos && <span className="small block">{formatDistance(distanceTo(location.pos, p))}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!rows.length && <p className="muted">Brak punktów. Dodaj je na mapie albo w zakładce Znajdź.</p>}
    </div>
  );
}
