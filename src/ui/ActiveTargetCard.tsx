import { useState } from 'react';
import { cancelNavigation } from '../data/actions';
import { googleMapsUrl, TARGET_KIND_LABEL } from '../lib/navigation';
import { OUTCOME_LABEL, type Outcome } from '../lib/types';
import { formatDateTime } from '../lib/time';
import { useApp, useSnapshot } from './hooks';
import { VisitForm } from './VisitForm';

export function ActiveTargetCard() {
  const { repo, toast, openPoint } = useApp();
  const { activeTarget } = useSnapshot();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  if (!activeTarget) return null;
  const point = repo.getPoint(activeTarget.pointId);
  if (!point) return null;

  if (collapsed) {
    return (
      <section className="active-target compact" aria-label="Aktywny cel">
        <span className="grow small"><b>Aktywny cel:</b> {point.name}</span>
        <button className="btn tiny" onClick={() => setCollapsed(false)}>Rozwiń</button>
      </section>
    );
  }

  return (
    <section className="active-target" aria-label="Aktywny cel">
      {outcome ? (
        <VisitForm key={outcome} pointId={point.id} outcome={outcome} onDone={() => setOutcome(null)} />
      ) : (
        <>
          <div className="row">
            <button className="linklike grow" onClick={() => openPoint(point.id)}><strong>{point.name}</strong></button>
            <button className="btn tiny" onClick={() => setCollapsed(true)}>Zwiń</button>
          </div>
          <p className="small">Nawigacja od {formatDateTime(activeTarget.startedAt)} do: {TARGET_KIND_LABEL[activeTarget.kind]}</p>
          <p className="question">Czy udało się rozwiesić plakat?</p>
          <div className="grid2">
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
              <button key={o} className={`btn outcome-${o}`} onClick={() => setOutcome(o)}>{OUTCOME_LABEL[o]}</button>
            ))}
            <button
              className="btn"
              onClick={async () => {
                try { await cancelNavigation(repo); toast('Anulowano dojazd. Nie zapisano wizyty.'); }
                catch { toast('Nie udało się zapisać. Spróbuj ponownie.', 'error'); }
              }}
            >Nie byłem / anuluj dojazd</button>
          </div>
          <a className="btn link-btn" href={googleMapsUrl(activeTarget)} target="_blank" rel="noopener">Otwórz Google Maps ponownie</a>
        </>
      )}
    </section>
  );
}
