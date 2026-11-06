import { useMemo, useState } from 'react';
import { archivePoint, cancelVisit, restorePoint, restoreVisit, startNavigation } from '../data/actions';
import { distanceTo } from '../lib/filters';
import { distanceM, formatDistance } from '../lib/geo';
import { googleMapsUrl, navigationTarget, TARGET_KIND_LABEL } from '../lib/navigation';
import { compareVisitsNewestFirst } from '../lib/status';
import { formatDateTime } from '../lib/time';
import { OUTCOME_LABEL, PLACE_LABEL, STATUS_LABEL, STATUS_SYMBOL, type Point, type Visit } from '../lib/types';
import { NEARBY_DUPLICATE_M } from '../osm/overpass';
import { useApp, useSnapshot } from './hooks';
import { PointForm } from './PointForm';
import { VisitForm } from './VisitForm';

function SyncLabel({ entity, rec }: { entity: 'point' | 'visit'; rec: Point | Visit }) {
  const { scope } = useApp();
  const { outbox } = useSnapshot();
  const op = outbox.get(`${entity}:${rec.id}`);
  if (scope.kind !== 'user') return <span className="small muted">Zapisano na telefonie</span>;
  if (op?.lastError) return <span className="small error-text">Błąd synchronizacji: {op.lastError}</span>;
  if (op) return <span className="small warn-text">Oczekuje na synchronizację</span>;
  return <span className="small ok-text">Zapisano w chmurze</span>;
}

function VisitRow({ visit, pointId }: { visit: Visit; pointId: string }) {
  const { repo, toast } = useApp();
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="visit"><VisitForm pointId={pointId} visit={visit} onDone={() => setEditing(false)} /></li>;
  const cancelled = !!visit.cancelledAt;
  return (
    <li className={`visit ${cancelled ? 'cancelled' : ''}`}>
      <strong>{formatDateTime(visit.visitedAt)}</strong> · {OUTCOME_LABEL[visit.outcome]} · plakaty: {visit.posterCount}
      {cancelled && <div className="small error-text">Anulowano {formatDateTime(visit.cancelledAt!)}{visit.cancelReason ? `: ${visit.cancelReason}` : ''}</div>}
      {visit.note && <div className="small">{visit.note}</div>}
      {visit.gps && <div className="small muted">GPS: {visit.gps.lat.toFixed(5)}, {visit.gps.lng.toFixed(5)}{visit.gps.accuracyM != null ? ` (±${Math.round(visit.gps.accuracyM)} m)` : ''}</div>}
      {visit.corrections.length > 0 && (
        <details className="small"><summary>Korekty: {visit.corrections.length}</summary>
          <ul>{visit.corrections.map((c) => (
            <li key={c.at}>{formatDateTime(c.at)}: było {OUTCOME_LABEL[c.before.outcome]}, plakaty {c.before.posterCount}, {formatDateTime(c.before.visitedAt)}{c.before.note ? `, „${c.before.note}”` : ''}</li>
          ))}</ul>
        </details>
      )}
      <SyncLabel entity="visit" rec={visit} />
      <div className="row">
        {!cancelled && <button className="btn tiny" onClick={() => setEditing(true)}>Popraw</button>}
        {!cancelled && (
          <button className="btn tiny" onClick={async () => {
            const reason = window.prompt('Anulować tę wizytę? Pozostanie w historii, ale nie będzie liczona. Powód (opcjonalnie):', '');
            if (reason === null) return;
            try { await cancelVisit(repo, visit, reason.trim() || null); toast('Anulowano wizytę'); }
            catch { toast('Nie udało się zapisać anulowania', 'error'); }
          }}>Anuluj wizytę</button>
        )}
        {cancelled && (
          <button className="btn tiny" onClick={async () => {
            try { await restoreVisit(repo, visit); toast('Przywrócono wizytę'); }
            catch { toast('Nie udało się zapisać', 'error'); }
          }}>Przywróć</button>
        )}
      </div>
    </li>
  );
}

export function PointSheet({ id, onClose, onOpenOther }: { id: string; onClose: () => void; onOpenOther: (id: string) => void }) {
  const { repo, toast, location } = useApp();
  const { points, visits, statuses, activeTarget } = useSnapshot();
  const [mode, setMode] = useState<'view' | 'edit' | 'visit'>('view');
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const point = points.find((p) => p.id === id);
  const history = useMemo(() => visits.filter((v) => v.pointId === id).sort(compareVisitsNewestFirst), [visits, id]);
  const nearby = useMemo(
    () => (point ? points.filter((o) => o.id !== id && !o.archivedAt && distanceM(point, o) <= NEARBY_DUPLICATE_M) : []),
    [points, point, id],
  );
  if (!point) return null;

  const status = statuses.get(id) ?? 'todo';
  const target = navigationTarget(point);

  async function navigate() {
    try {
      await startNavigation(repo, point!); // najpierw trwały zapis celu
    } catch {
      toast('Nie zapisano aktywnego celu, nawigacja nie została uruchomiona.', 'error');
      return;
    }
    const url = googleMapsUrl(target);
    const win = window.open(url, '_blank');
    if (win) { win.opener = null; onClose(); }
    else setBlockedUrl(url); // Safari mógł zablokować okno: użytkownik stuka w zwykły link
  }

  async function archive() {
    const reason = window.prompt('Zarchiwizować ten punkt? Zniknie z mapy i listy, ale historia zostanie. Powód (opcjonalnie):', '');
    if (reason === null) return;
    try { await archivePoint(repo, point!, reason.trim() || null); toast('Zarchiwizowano punkt'); onClose(); }
    catch { toast('Nie udało się zapisać', 'error'); }
  }

  return (
    <div className="overlay" role="dialog" aria-label={point.name}>
      <header className="sheet-head">
        <strong className="grow">{point.name}</strong>
        <button className="btn tiny" onClick={onClose}>Zamknij</button>
      </header>
      <div className="scroll pad stack">
        <div className="row wrap">
          <span className={`badge status-${status}`}>{STATUS_SYMBOL[status]} {STATUS_LABEL[status]}</span>
          {point.archivedAt && <span className="badge">Zarchiwizowany{point.archiveReason ? `: ${point.archiveReason}` : ''}</span>}
          <SyncLabel entity="point" rec={point} />
        </div>

        {!point.archivedAt && (
          <section className="stack">
            <button className="btn primary" data-testid="navigate" onClick={navigate}>Nawiguj</button>
            <p className="small muted">
              Google Maps poprowadzi do: <b>{TARGET_KIND_LABEL[target.kind]}</b> ({target.lat.toFixed(5)}, {target.lng.toFixed(5)})
              {location.pos ? ` · ${formatDistance(distanceTo(location.pos, point))}` : ''}
              {activeTarget?.pointId === id ? ' · to Twój aktywny cel' : ''}
            </p>
            {blockedUrl && <a className="btn link-btn" href={blockedUrl} target="_blank" rel="noopener" onClick={onClose}>Otwórz Google Maps</a>}
            {mode === 'visit'
              ? <VisitForm pointId={id} onDone={() => setMode('view')} />
              : <button className="btn" onClick={() => setMode('visit')}>Zapisz wizytę</button>}
          </section>
        )}

        <section className="stack">
          <h3>Dane</h3>
          <dl className="details">
            <dt>Typ</dt><dd>{PLACE_LABEL[point.placeType]}</dd>
            <dt>Miejscowość</dt><dd>{point.locality || <span className="muted">brak danych</span>}</dd>
            {point.address && <><dt>Adres</dt><dd>{point.address}</dd></>}
            <dt>Rejon</dt><dd>{point.region || <span className="muted">nie ustawiono</span>}</dd>
            <dt>Obiekt</dt><dd>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</dd>
            {point.boardLat != null && <><dt>Tablica</dt><dd>{point.boardLat.toFixed(5)}, {point.boardLng!.toFixed(5)}</dd></>}
            <dt>Źródło</dt><dd>{point.source === 'osm' ? `OpenStreetMap (${point.sourceRef})` : point.source === 'import' ? `Import${point.sourceRef ? ` (${point.sourceRef})` : ''}` : 'Dodano ręcznie'}</dd>
          </dl>
          {point.osm?.representative && point.boardLat == null && (
            <p className="notice small">Współrzędne to środek obszaru z OpenStreetMap, nie potwierdzone wejście ani tablica.</p>
          )}
          {point.note && <p className="note-text">{point.note}</p>}
          {nearby.length > 0 && (
            <p className="notice small">Możliwy duplikat w pobliżu: {nearby.map((o) => (
              <button key={o.id} className="linklike" onClick={() => onOpenOther(o.id)}>{o.name}</button>
            ))}</p>
          )}
          <div className="row wrap">
            <button className="btn tiny" onClick={() => setMode('edit')}>Edytuj</button>
            {point.archivedAt
              ? <button className="btn tiny" onClick={() => restorePoint(repo, point).then(() => toast('Przywrócono punkt'), () => toast('Nie udało się zapisać', 'error'))}>Przywróć z archiwum</button>
              : <button className="btn tiny" onClick={archive}>Archiwizuj</button>}
          </div>
        </section>

        <section className="stack">
          <h3>Historia wizyt ({history.length})</h3>
          {!history.length && <p className="muted small">Brak wizyt.</p>}
          <ul className="visits">{history.map((v) => <VisitRow key={v.id} visit={v} pointId={id} />)}</ul>
        </section>
      </div>
      {mode === 'edit' && <PointForm point={point} onClose={() => setMode('view')} />}
    </div>
  );
}
