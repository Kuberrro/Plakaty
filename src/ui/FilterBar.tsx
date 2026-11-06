import { regionsOf, type Filters } from '../lib/filters';
import { NO_REGION } from '../lib/stats';
import { STATUS_LABEL, STATUS_SYMBOL, type PointStatus } from '../lib/types';
import { useSnapshot } from './hooks';

const ALL: PointStatus[] = ['todo', 'posted', 'return', 'impossible'];

export function FilterBar({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const { points } = useSnapshot();
  const regions = regionsOf(points);
  const toggle = (s: PointStatus) => onChange({
    ...value, statuses: value.statuses.includes(s) ? value.statuses.filter((x) => x !== s) : [...value.statuses, s],
  });
  return (
    <div className="filters">
      <input type="search" aria-label="Szukaj" placeholder="Szukaj nazwy lub miejscowości" value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} />
      <div className="chips">
        {ALL.map((s) => (
          <button key={s} className={`chip status-${s} ${value.statuses.includes(s) ? 'on' : ''}`} aria-pressed={value.statuses.includes(s)} onClick={() => toggle(s)}>
            <span aria-hidden>{STATUS_SYMBOL[s]}</span> {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <select aria-label="Rejon" value={value.region ?? ''} onChange={(e) => onChange({ ...value, region: e.target.value || null })}>
        <option value="">Wszystkie rejony</option>
        {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        <option value={NO_REGION}>{NO_REGION}</option>
      </select>
    </div>
  );
}
