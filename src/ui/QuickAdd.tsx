import { useEffect, useMemo, useState } from 'react';
import { addVisit, defaultPosters, quickAdd } from '../data/actions';
import { pointsNear, regionsOf } from '../lib/filters';
import { formatDateTime } from '../lib/time';
import { OUTCOME_LABEL, PLACE_LABEL, PLACE_TYPES, type Outcome, type PlaceType, type Point, type VisitGps } from '../lib/types';
import { CoordPicker } from './CoordPicker';
import { readPosition, useApp, useSnapshot } from './hooks';

const LAST_TYPE = 'plakaty-last-type';
const LAST_REGION = 'plakaty-last-region';
const NEAR_M = 40;
const POOR_ACCURACY_M = 60;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* bez znaczenia */ } };

/**
 * Jeden ekran: lokalizacja telefonu (jednorazowo, po stuknięciu), rodzaj, opcjonalna nazwa,
 * wynik i liczba plakatów. Zapis = nowy punkt + wizyta w jednej transakcji.
 */
export function QuickAdd({ onClose }: { onClose: (point?: Point) => void }) {
  const { repo, toast } = useApp();
  const { points } = useSnapshot();
  const [gps, setGps] = useState<VisitGps | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsState, setGpsState] = useState<'reading' | 'ok' | 'error'>('reading');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [placeType, setPlaceType] = useState<PlaceType>(() => (PLACE_TYPES.includes(read(LAST_TYPE) as PlaceType) ? read(LAST_TYPE) as PlaceType : 'notice_board'));
  const [name, setName] = useState('');
  const [region, setRegion] = useState(() => read(LAST_REGION) ?? '');
  const [outcome, setOutcome] = useState<Outcome>('posted');
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function locate() {
    setGpsState('reading');
    setGpsError(null);
    try {
      const r = await readPosition();
      const g = { lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, measuredAt: r.measuredAt };
      setGps(g);
      setPos({ lat: r.lat, lng: r.lng });
      setGpsState('ok');
    } catch (e) {
      setGpsError((e as Error).message);
      setGpsState('error');
    }
  }
  useEffect(() => { void locate(); }, []);

  const near = useMemo(() => (pos ? pointsNear(points, pos, NEAR_M) : []), [points, pos]);
  const autoName = `${PLACE_LABEL[placeType]} · ${formatDateTime(new Date().toISOString())}`;

  async function save() {
    if (!pos) return;
    setBusy(true);
    setError(null);
    try {
      const { point } = await quickAdd(repo, {
        name: name.trim() || autoName, placeType, region: region.trim() || null, lat: pos.lat, lng: pos.lng,
        outcome, posterCount: count, note, gps,
      });
      write(LAST_TYPE, placeType);
      write(LAST_REGION, region.trim());
      toast('Zapisano na telefonie: punkt i wizyta');
      onClose(point);
    } catch (e) {
      setError(`Nie zapisano: ${(e as Error).message || 'błąd pamięci urządzenia'}. Dane są nadal w formularzu.`);
    } finally {
      setBusy(false);
    }
  }

  async function visitExisting(p: Point) {
    setBusy(true);
    try {
      await addVisit(repo, { pointId: p.id, visitedAt: new Date().toISOString(), outcome, posterCount: count, note: note.trim(), gps });
      toast(`Zapisano wizytę: ${p.name}`);
      onClose(p);
    } catch {
      setError('Nie zapisano wizyty. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-label="Plakat w tym miejscu">
      <header className="sheet-head">
        <strong>Plakat w tym miejscu</strong>
        <button className="btn tiny" onClick={() => onClose()}>Anuluj</button>
      </header>
      <div className="scroll pad stack">
        <section className="stack" aria-live="polite">
          {gpsState === 'reading' && <p className="notice">Ustalam lokalizację telefonu…</p>}
          {gpsState === 'error' && !pos && (
            <div className="stack notice">
              <p>{gpsError}</p>
              <div className="row wrap">
                <button className="btn tiny" onClick={() => void locate()}>Spróbuj ponownie</button>
                <button className="btn tiny" onClick={() => setPicking(true)}>Wskaż na mapie</button>
              </div>
            </div>
          )}
          {pos && (
            <p className="small" data-testid="quick-position">
              Miejsce: {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
              {gps && pos.lat === gps.lat && pos.lng === gps.lng
                ? ` (GPS, dokładność ok. ${Math.round(gps.accuracyM ?? 0)} m)`
                : ' (wskazane na mapie)'}
              {' · '}<button className="linklike" onClick={() => setPicking(true)}>Popraw na mapie</button>
            </p>
          )}
          {gps && (gps.accuracyM ?? 0) > POOR_ACCURACY_M && pos?.lat === gps.lat && (
            <p className="notice small">Słaba dokładność GPS. Możesz poprawić miejsce na mapie albo spróbować za chwilę.</p>
          )}
        </section>

        {near.length > 0 && (
          <section className="notice stack" data-testid="quick-near">
            <p><b>W pobliżu jest już zapisany punkt.</b> Zapisać wizytę w nim zamiast tworzyć nowy?</p>
            {near.slice(0, 3).map(({ point, distance }) => (
              <button key={point.id} className="btn tiny" disabled={busy} onClick={() => void visitExisting(point)}>
                Wizyta w: {point.name} ({Math.round(distance)} m)
              </button>
            ))}
          </section>
        )}

        <div>
          <p className="label">Rodzaj miejsca</p>
          <div className="chips" role="radiogroup" aria-label="Rodzaj miejsca">
            {PLACE_TYPES.map((t) => (
              <button key={t} role="radio" aria-checked={t === placeType} className={`chip ${t === placeType ? 'on' : ''}`} onClick={() => setPlaceType(t)}>
                {PLACE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <label>Nazwa (opcjonalnie)
          <input value={name} maxLength={200} placeholder={autoName} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="segmented" role="radiogroup" aria-label="Wynik">
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={o === outcome} className={o === outcome ? `sel outcome-${o}` : ''} onClick={() => { setOutcome(o); setCount(defaultPosters(o)); }}>
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>
        <div className="stepper">
          <span>Liczba plakatów</span>
          <button type="button" className="btn" aria-label="Mniej" onClick={() => setCount((c) => Math.max(0, c - 1))}>−</button>
          <input aria-label="Liczba plakatów" type="number" inputMode="numeric" min={0} max={1000} value={count} onChange={(e) => setCount(e.target.value === '' ? 0 : Number(e.target.value))} />
          <button type="button" className="btn" aria-label="Więcej" onClick={() => setCount((c) => Math.min(1000, c + 1))}>+</button>
        </div>

        <details>
          <summary className="small">Rejon i notatka</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <label>Rejon
              <input list="quick-regiony" value={region} onChange={(e) => setRegion(e.target.value)} />
              <datalist id="quick-regiony">{regionsOf(points).map((r) => <option key={r} value={r} />)}</datalist>
            </label>
            <label>Notatka<textarea rows={2} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
        </details>

        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary big" disabled={!pos || busy} onClick={save}>
          {busy ? 'Zapisuję…' : near.length ? 'Mimo to dodaj nowy punkt' : 'Zapisz punkt i wizytę'}
        </button>
      </div>
      {picking && (
        <CoordPicker
          title="Wskaż miejsce plakatu"
          start={pos ?? { lat: 50.0614, lng: 19.9366 }}
          onCancel={() => setPicking(false)}
          onPick={(p) => { setPos(p); setPicking(false); }}
        />
      )}
    </div>
  );
}
