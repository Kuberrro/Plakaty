import type L from 'leaflet';
import LeafletLib from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { regionsOf } from '../lib/filters';
import { formatDateTime } from '../lib/time';
import {
  ALL_CATEGORIES, cacheKey, CACHE_TTL_MS, CATEGORIES, candidateState, candidateToPoint, DEFAULT_CATEGORIES, DEFAULT_RADIUS_KM, ERROR_TEXT,
  KRAKOW, MAX_RESULTS, MIN_RADIUS_KM, OverpassError, possibleDuplicates, radiusLimit, searchPlaces,
  type Candidate, type CandidateState, type OverpassErrorKind, type SearchCategory,
} from '../osm/overpass';
import { BaseMap, statusIcon } from './BaseMap';
import { CoordPicker } from './CoordPicker';
import { useApp, useOnline, useSnapshot } from './hooks';

interface Result { candidates: Candidate[]; fetchedAt: string; cached: boolean; truncated: boolean }
const LIST_LIMIT = 300;
const STATE_TEXT: Record<Exclude<CandidateState, 'new'>, string> = { 'in-base': 'Już w bazie', archived: 'W archiwum', deleted: 'W koszu' };

export function FindView() {
  const { repo, toast } = useApp();
  const { points } = useSnapshot();
  const online = useOnline();
  const [center, setCenter] = useState(KRAKOW);
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS_KM));
  const [cats, setCats] = useState<SearchCategory[]>(DEFAULT_CATEGORIES);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [region, setRegion] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const radiusKm = Number(radius.replace(',', '.'));
  const limit = cats.length ? radiusLimit(cats) : 0;
  const radiusOk = radiusKm >= MIN_RADIUS_KM && radiusKm <= limit;

  const rows = useMemo(() => {
    const cands = result?.candidates ?? [];
    const others = [
      ...points.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
      ...cands.map((x) => ({ id: x.id, name: x.name, lat: x.lat, lng: x.lng })),
    ];
    return cands.map((c) => ({ c, state: candidateState(c, points), dups: possibleDuplicates(c, others) }));
  }, [result, points]);
  const fresh = rows.filter((r) => r.state === 'new');
  const visible = onlyNew ? fresh : rows;

  useEffect(() => {
    if (!map.current) return;
    layer.current ??= LeafletLib.layerGroup().addTo(map.current);
    layer.current.clearLayers();
    for (const { c, state } of rows) {
      LeafletLib.marker([c.lat, c.lng], { icon: statusIcon(state === 'new' ? 'candidate' : 'known', state === 'new' ? '?' : '•'), title: c.name }).addTo(layer.current);
    }
    if (rows.length) map.current.fitBounds(LeafletLib.latLngBounds(rows.map((r) => [r.c.lat, r.c.lng])).pad(0.1), { maxZoom: 13 });
  }, [rows]);

  async function search(force: boolean) {
    if (!radiusOk || !cats.length) return;
    setError(null);
    const key = cacheKey(center.lat, center.lng, radiusKm, cats);
    const showCached = (hit: { fetchedAt: string; payload: unknown }) => {
      const p = hit.payload as { candidates: Candidate[]; truncated: boolean };
      setResult({ candidates: p.candidates, fetchedAt: hit.fetchedAt, cached: true, truncated: p.truncated });
      setSelected(new Set());
    };
    const stored = await repo.db.get('overpassCache', key);
    // Wpisy ze starszej wersji (sama tablica wyników) pomijamy: zostaną pobrane na nowo.
    const hit = stored && !Array.isArray(stored.payload) ? stored : undefined;
    if (hit && !force && Date.now() - Date.parse(hit.fetchedAt) < CACHE_TTL_MS) { showCached(hit); return; }
    setBusy(true);
    abort.current = new AbortController();
    try {
      const r = await searchPlaces(center, radiusKm, cats, { signal: abort.current.signal });
      await repo.db.put('overpassCache', { key, fetchedAt: r.fetchedAt, payload: { candidates: r.candidates, truncated: r.truncated } });
      setResult({ candidates: r.candidates, fetchedAt: r.fetchedAt, cached: false, truncated: r.truncated });
      setSelected(new Set());
    } catch (e) {
      const kind: OverpassErrorKind = e instanceof OverpassError ? e.kind : 'server';
      setError(e instanceof OverpassError ? ERROR_TEXT[kind] : (e as Error).message);
      if (hit) showCached(hit);
    } finally {
      setBusy(false);
    }
  }

  async function add(list: Candidate[]) {
    // Zawsze na bieżąco: tylko obiekty, których nie ma w bazie (także w koszu). Istniejących nie dotykamy.
    const toAdd = list.filter((c) => candidateState(c, repo.getSnapshot().points) === 'new');
    if (!toAdd.length) return;
    if (!window.confirm(`Dodać do bazy: ${toAdd.length}?`)) return;
    try {
      await repo.commit({ points: toAdd.map((c) => candidateToPoint(c, repo.ownerId, region.trim() || null)) });
      setSelected(new Set());
      toast(`Zapisano na telefonie: ${toAdd.length}`);
    } catch {
      toast('Nie udało się zapisać punktów', 'error');
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  };
  const toggleCat = (c: SearchCategory) => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]);

  return (
    <div className="scroll pad stack">
      <h2>Znajdź miejsca</h2>
      <p className="notice small">Wyniki pochodzą z OpenStreetMap i mogą być niekompletne. Obecność obiektu nie potwierdza dostępności tablicy ani możliwości powieszenia plakatu.</p>
      <fieldset>
        <legend>Czego szukać</legend>
        <div className="cat-list">
          {ALL_CATEGORIES.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={cats.includes(c)} onChange={() => toggleCat(c)} />
              <span><b>{CATEGORIES[c].label}</b>{CATEGORIES[c].hint && <span className="small muted block">{CATEGORIES[c].hint}</span>}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="find-map">
        <BaseMap center={[center.lat, center.lng]} zoom={9} onReady={(m) => { map.current = m; layer.current = null; }} className="map" />
      </div>
      <p className="small">Środek obszaru: {center.lat.toFixed(4)}, {center.lng.toFixed(4)} {center === KRAKOW && '(Kraków)'}</p>
      <div className="row wrap">
        <button className="btn tiny" onClick={() => setPicking(true)}>Zmień środek na mapie</button>
        <label className="inline">Promień (km)
          <input aria-label="Promień w kilometrach" inputMode="decimal" className="short" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </label>
      </div>
      {!cats.length && <p className="error-text small">Wybierz co najmniej jeden rodzaj miejsc.</p>}
      {cats.length > 0 && !radiusOk && <p className="error-text small">Dla wybranych rodzajów promień musi wynosić {MIN_RADIUS_KM}–{limit} km.</p>}
      <button className="btn primary" disabled={busy || !radiusOk || !cats.length || !online} onClick={() => search(false)}>{busy ? 'Szukam…' : 'Wyszukaj'}</button>
      {!online && <p className="notice small">{ERROR_TEXT.offline}</p>}
      {error && (
        <div className="stack">
          <p className="error-text" role="alert">{error}</p>
          <button className="btn" disabled={busy || !online} onClick={() => search(true)}>Spróbuj ponownie</button>
        </div>
      )}
      {result && (
        <>
          <p className="small muted" data-testid="find-summary">
            Wyników: {result.candidates.length}, nowych: {fresh.length}. Pobrano {formatDateTime(result.fetchedAt)}{result.cached ? ' (zapamiętane wyniki)' : ''}.{' '}
            {result.cached && <button className="linklike" disabled={busy || !online} onClick={() => search(true)}>Pobierz na nowo</button>}
          </p>
          {result.truncated && <p className="notice small">Wyników jest więcej niż {MAX_RESULTS}; pokazano część. Zmniejsz promień albo liczbę rodzajów.</p>}
          {result.candidates.length === 0 && <p className="notice small">Brak takich obiektów w OSM w tym obszarze. To nie znaczy, że ich nie ma: dodawaj je przyciskiem „Plakat w tym miejscu”.</p>}
          <label>Rejon dla dodawanych punktów (opcjonalnie)
            <input list="find-regiony" value={region} onChange={(e) => setRegion(e.target.value)} />
            <datalist id="find-regiony">{regionsOf(points).map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <div className="row wrap">
            <button className="btn" disabled={!selected.size} onClick={() => add(fresh.filter((r) => selected.has(r.c.id)).map((r) => r.c))}>Dodaj wybrane ({selected.size})</button>
            <button className="btn" disabled={!fresh.length} onClick={() => add(fresh.map((r) => r.c))}>Dodaj wszystkie nowe ({fresh.length})</button>
          </div>
          <label className="inline small"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Pokaż tylko nowe</label>
          <ul className="point-list candidates">
            {visible.slice(0, LIST_LIMIT).map(({ c, state, dups }) => (
              <li key={c.id}>
                <label className="candidate">
                  <input type="checkbox" disabled={state !== 'new'} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="grow">
                    <strong>{c.name}</strong>
                    <span className="small muted block">
                      {CATEGORIES[c.category ?? 'fire_station'].label} · {[c.locality, c.address].filter(Boolean).join(', ') || 'brak adresu w OSM'} · {c.ref}
                      {c.osm.tags.operator ? ` · operator: ${c.osm.tags.operator}` : ''}
                    </span>
                    {c.osm.representative && <span className="small muted block">Środek obszaru, nie potwierdzone wejście</span>}
                    {state !== 'new' && <span className={`small block ${state === 'in-base' ? 'ok-text' : 'muted'}`}>{STATE_TEXT[state]}</span>}
                    {dups.length > 0 && <span className="small warn-text block">Możliwy duplikat: {dups.map((d) => d.name).join(', ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {visible.length > LIST_LIMIT && <p className="small muted">Lista pokazuje {LIST_LIMIT} z {visible.length}. „Dodaj wszystkie nowe” obejmuje wszystkie.</p>}
        </>
      )}
      {picking && (
        <CoordPicker
          title="Środek obszaru wyszukiwania"
          start={center}
          onCancel={() => setPicking(false)}
          onPick={(p) => { setCenter(p); setPicking(false); map.current?.setView([p.lat, p.lng], 10); }}
        />
      )}
    </div>
  );
}
