import { useMemo, useState } from 'react';
import { reportCsv } from '../io/exports';
import { saveFile } from '../io/share';
import { regionsOf } from '../lib/filters';
import { buildReport, computeCounters, countersByRegion, NO_REGION } from '../lib/stats';
import { formatDateTime, warsawDay } from '../lib/time';
import { OUTCOME_LABEL } from '../lib/types';
import { useApp, useSnapshot } from './hooks';

const COUNTERS = [
  ['active', 'Aktywne punkty', 'Punkty niezarchiwizowane.'],
  ['uniqueVisited', 'Unikalne odwiedzone', 'Aktywne punkty z co najmniej jedną nieanulowaną wizytą. Kilka wizyt w jednym miejscu liczy się raz.'],
  ['posted', 'Status: plakat powieszony', 'Punkty, których ostatnia wizyta to „plakat powieszony”.'],
  ['postersTotal', 'Suma plakatów', 'Plakaty z nieanulowanych wizyt, także w punktach później zarchiwizowanych.'],
  ['todo', 'Do odwiedzenia', 'Punkty bez nieanulowanej wizyty.'],
  ['return', 'Do powrotu', 'Punkty, których ostatnia wizyta to „wrócić”.'],
  ['impossible', 'Bez możliwości', 'Punkty, których ostatnia wizyta to „brak możliwości”.'],
] as const;

export function ReportsView() {
  const { toast, openPoint } = useApp();
  const { points, visits, statuses } = useSnapshot();
  const today = warsawDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [region, setRegion] = useState('');

  const counters = useMemo(() => computeCounters(points, visits, statuses), [points, visits, statuses]);
  const regions = useMemo(() => countersByRegion(points, visits, statuses), [points, visits, statuses]);
  const report = useMemo(
    () => buildReport(points, visits, statuses, { from: from || null, to: to || null, region: region || null }),
    [points, visits, statuses, from, to, region],
  );

  async function exportCsv() {
    try {
      const ok = await saveFile(`plakaty-raport-${from || 'poczatek'}_${to || 'dzis'}.csv`, reportCsv(report), 'text/csv;charset=utf-8');
      if (ok) toast('Raport gotowy');
    } catch { toast('Nie udało się zapisać pliku', 'error'); }
  }

  return (
    <div className="scroll pad stack report">
      <h2>Postęp</h2>
      <div className="counters">
        {COUNTERS.map(([k, label, hint]) => (
          <div key={k} className="counter" title={hint}><b data-testid={`count-${k}`}>{counters[k]}</b><span>{label}</span></div>
        ))}
      </div>
      <details className="no-print small"><summary>Co oznaczają liczniki</summary>
        <ul>{COUNTERS.map(([k, label, hint]) => <li key={k}><b>{label}:</b> {hint}</li>)}</ul>
        <p>Wizyta to jedno zdarzenie, punkt to miejsce, plakaty to sztuki. Anulowane wizyty nie są liczone.</p>
      </details>
      {regions.length > 0 && (
        <>
          <h3>Według rejonu</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Rejon</th><th>Punkty</th><th>Odwiedzone</th><th>Powieszone</th><th>Powrót</th><th>Plakaty</th></tr></thead>
            <tbody>{regions.map((r) => (
              <tr key={r.region}><td>{r.region}</td><td>{r.active}</td><td>{r.uniqueVisited}</td><td>{r.posted}</td><td>{r.return}</td><td>{r.postersTotal}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      <h2>Raport wizyt</h2>
      <div className="row wrap no-print">
        <label className="grow">Od<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grow">Do<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <select className="no-print" aria-label="Rejon raportu" value={region} onChange={(e) => setRegion(e.target.value)}>
        <option value="">Wszystkie rejony</option>
        {regionsOf(points).map((r) => <option key={r} value={r}>{r}</option>)}
        <option value={NO_REGION}>{NO_REGION}</option>
      </select>
      <p className="print-only small">Zakres: {from || 'początek'} – {to || 'dziś'}{region ? `, rejon: ${region}` : ''}. Czas: Europe/Warsaw.</p>
      <p data-testid="report-summary">Wizyty: <b>{report.visits.length}</b> · unikalne miejsca: <b>{report.uniquePlaces}</b> · plakaty: <b>{report.posters}</b></p>
      <div className="row wrap no-print">
        <button className="btn" disabled={!report.visits.length} onClick={exportCsv}>Eksportuj CSV</button>
        <button className="btn" onClick={() => window.print()}>Drukuj</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Data</th><th>Miejsce</th><th>Wynik</th><th>Plakaty</th><th>Notatka</th></tr></thead>
        <tbody>{report.visits.map(({ visit: v, point: p }) => (
          <tr key={v.id}>
            <td>{formatDateTime(v.visitedAt)}</td>
            <td>{p?.name ?? '(nieznany punkt)'}{p?.locality ? `, ${p.locality}` : ''}<div className="small muted">{p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ''}</div></td>
            <td>{OUTCOME_LABEL[v.outcome]}</td><td>{v.posterCount}</td><td>{v.note}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <h3>Punkty wymagające powrotu ({report.toReturn.length})</h3>
      <ul className="plain">{report.toReturn.map((p) => (
        <li key={p.id}><button className="linklike" onClick={() => openPoint(p.id)}>{p.name}</button>{p.locality ? `, ${p.locality}` : ''}</li>
      ))}</ul>
      <p className="small muted">Aplikacja nie mierzy tras, kilometrów ani czasu jazdy.</p>
    </div>
  );
}
