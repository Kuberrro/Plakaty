import { useState } from 'react';
import { addVisit, correctVisit, defaultPosters } from '../data/actions';
import { fromWarsawInput, toWarsawInput } from '../lib/time';
import { OUTCOME_LABEL, type Outcome, type Visit, type VisitGps } from '../lib/types';
import { readPosition, useApp } from './hooks';

interface Props {
  pointId: string;
  outcome?: Outcome;
  /** Korekta istniejącego wpisu. */
  visit?: Visit;
  onDone: () => void;
}

export function VisitForm({ pointId, outcome: initial, visit, onDone }: Props) {
  const { repo, toast } = useApp();
  const [outcome, setOutcome] = useState<Outcome>(visit?.outcome ?? initial ?? 'posted');
  const [count, setCount] = useState(visit?.posterCount ?? defaultPosters(outcome));
  const [note, setNote] = useState(visit?.note ?? '');
  const [when, setWhen] = useState(toWarsawInput(visit?.visitedAt ?? new Date().toISOString()));
  const [showWhen, setShowWhen] = useState(!!visit);
  const [gps, setGps] = useState<VisitGps | null>(null);
  const [gpsState, setGpsState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (o: Outcome) => { setOutcome(o); if (!visit) setCount(defaultPosters(o)); };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const visitedAt = fromWarsawInput(when);
      if (visit) await correctVisit(repo, visit, { visitedAt, outcome, posterCount: count, note: note.trim() });
      else await addVisit(repo, { pointId, visitedAt, outcome, posterCount: count, note: note.trim(), gps });
      toast('Zapisano na telefonie');
      onDone();
    } catch (e) {
      // Formularz zostaje otwarty z wpisanymi danymi.
      setError(`Nie zapisano: ${(e as Error).message || 'błąd pamięci urządzenia'}. Twoje dane są nadal w formularzu.`);
    } finally {
      setBusy(false);
    }
  }

  async function measure() {
    setGpsState('Mierzę…');
    try {
      const r = await readPosition();
      setGps({ lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, measuredAt: r.measuredAt });
      setGpsState(`Pomiar dodany (dokładność ok. ${Math.round(r.accuracyM ?? 0)} m)`);
    } catch (e) {
      setGpsState((e as Error).message);
    }
  }

  return (
    <div className="stack visit-form">
      <div className="segmented" role="radiogroup" aria-label="Wynik wizyty">
        {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === outcome} className={o === outcome ? `sel outcome-${o}` : ''} onClick={() => pick(o)}>
            {OUTCOME_LABEL[o]}
          </button>
        ))}
      </div>
      <div className="stepper">
        <span>Liczba plakatów</span>
        <button type="button" className="btn" aria-label="Mniej" onClick={() => setCount((c) => Math.max(0, c - 1))}>−</button>
        <input
          aria-label="Liczba plakatów" type="number" inputMode="numeric" min={0} max={1000} value={count}
          onChange={(e) => setCount(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        <button type="button" className="btn" aria-label="Więcej" onClick={() => setCount((c) => Math.min(1000, c + 1))}>+</button>
      </div>
      <label>Notatka (opcjonalnie)<textarea rows={2} value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} /></label>
      {showWhen
        ? <label>Data i godzina (czas polski)<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        : <button type="button" className="linklike small" onClick={() => setShowWhen(true)}>Zmień datę lub godzinę</button>}
      {!visit && (
        <div>
          <button type="button" className="linklike small" onClick={measure}>Dodaj pomiar GPS telefonu (opcjonalnie)</button>
          {gpsState && <p className="small muted">{gpsState}</p>}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary grow" disabled={busy || !when} onClick={save}>{busy ? 'Zapisuję…' : visit ? 'Zapisz korektę' : 'Zapisz wizytę'}</button>
        <button className="btn" disabled={busy} onClick={onDone}>Wróć</button>
      </div>
    </div>
  );
}
