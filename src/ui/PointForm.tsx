import { useState } from 'react';
import { createManualPoint, updatePoint, type PointDraft } from '../data/actions';
import { regionsOf } from '../lib/filters';
import { parseCoord, validLat, validLng } from '../lib/geo';
import { PLACE_LABEL, type PlaceType, type Point } from '../lib/types';
import { CoordPicker } from './CoordPicker';
import { useApp, useSnapshot } from './hooks';

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function PointForm({ point, initial, onClose }: {
  point?: Point; initial?: { lat: number; lng: number }; onClose: (id?: string) => void;
}) {
  const { repo, toast } = useApp();
  const { points } = useSnapshot();
  const [f, setF] = useState({
    name: point?.name ?? '', placeType: point?.placeType ?? ('notice_board' as PlaceType), locality: point?.locality ?? '',
    address: point?.address ?? '', region: point?.region ?? '', note: point?.note ?? '',
    lat: str(point?.lat ?? initial?.lat), lng: str(point?.lng ?? initial?.lng),
    boardLat: str(point?.boardLat), boardLng: str(point?.boardLng),
  });
  const [picking, setPicking] = useState<'object' | 'board' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function parse(): PointDraft {
    if (!f.name.trim()) throw new Error('Podaj nazwę.');
    const lat = parseCoord(f.lat);
    const lng = parseCoord(f.lng);
    if (!f.lat.trim() || !f.lng.trim() || !validLat(lat) || !validLng(lng)) throw new Error('Niepoprawne współrzędne obiektu (szerokość −90…90, długość −180…180).');
    const hasBoard = !!(f.boardLat.trim() || f.boardLng.trim());
    const boardLat = hasBoard ? parseCoord(f.boardLat) : null;
    const boardLng = hasBoard ? parseCoord(f.boardLng) : null;
    if (hasBoard && (!validLat(boardLat!) || !validLng(boardLng!) || !f.boardLat.trim() || !f.boardLng.trim())) throw new Error('Niepoprawne współrzędne tablicy.');
    return {
      name: f.name.trim(), placeType: f.placeType, locality: f.locality.trim(), address: f.address.trim() || null,
      region: f.region.trim() || null, note: f.note.trim(), lat, lng, boardLat, boardLng,
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const d = parse();
      if (point) { await updatePoint(repo, repo.getPoint(point.id) ?? point, d); onClose(point.id); }
      else onClose((await createManualPoint(repo, d)).id);
      toast('Zapisano na telefonie');
    } catch (e) {
      setError((e as Error).message || 'Nie udało się zapisać. Dane są nadal w formularzu.');
    } finally {
      setBusy(false);
    }
  }

  const here = (lat: string, lng: string) => ({ lat: parseCoord(lat) || 50.0614, lng: parseCoord(lng) || 19.9366 });

  return (
    <div className="overlay" role="dialog" aria-label={point ? 'Edycja punktu' : 'Nowy punkt'}>
      <header className="sheet-head">
        <strong>{point ? 'Edycja punktu' : 'Nowy punkt'}</strong>
        <button className="btn tiny" onClick={() => onClose()}>Anuluj</button>
      </header>
      <div className="scroll pad stack">
        <label>Nazwa<input value={f.name} maxLength={200} onChange={set('name')} /></label>
        <label>Typ miejsca
          <select value={f.placeType} onChange={set('placeType')}>
            {(Object.keys(PLACE_LABEL) as PlaceType[]).map((t) => <option key={t} value={t}>{PLACE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>Miejscowość<input value={f.locality} onChange={set('locality')} /></label>
        <label>Adres (opcjonalnie)<input value={f.address} onChange={set('address')} /></label>
        <label>Rejon
          <input list="regiony" value={f.region} onChange={set('region')} />
          <datalist id="regiony">{regionsOf(points).map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <fieldset>
          <legend>Lokalizacja obiektu</legend>
          <div className="row">
            <label className="grow">Szerokość<input inputMode="decimal" value={f.lat} onChange={set('lat')} /></label>
            <label className="grow">Długość<input inputMode="decimal" value={f.lng} onChange={set('lng')} /></label>
          </div>
          <button type="button" className="btn tiny" onClick={() => setPicking('object')}>Wskaż na mapie</button>
        </fieldset>
        <fieldset>
          <legend>Lokalizacja tablicy (opcjonalnie)</legend>
          <div className="row">
            <label className="grow">Szerokość<input inputMode="decimal" value={f.boardLat} onChange={set('boardLat')} /></label>
            <label className="grow">Długość<input inputMode="decimal" value={f.boardLng} onChange={set('boardLng')} /></label>
          </div>
          <div className="row">
            <button type="button" className="btn tiny" onClick={() => setPicking('board')}>Wskaż na mapie</button>
            {(f.boardLat || f.boardLng) && <button type="button" className="btn tiny" onClick={() => setF({ ...f, boardLat: '', boardLng: '' })}>Usuń tablicę</button>}
          </div>
        </fieldset>
        <label>Notatka o miejscu<textarea rows={3} value={f.note} maxLength={5000} onChange={set('note')} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Zapisuję…' : 'Zapisz punkt'}</button>
      </div>
      {picking && (
        <CoordPicker
          title={picking === 'board' ? 'Wskaż tablicę' : 'Wskaż obiekt'}
          start={picking === 'board' ? here(f.boardLat || f.lat, f.boardLng || f.lng) : here(f.lat, f.lng)}
          onCancel={() => setPicking(null)}
          onPick={(p) => {
            setF(picking === 'board' ? { ...f, boardLat: String(p.lat), boardLng: String(p.lng) } : { ...f, lat: String(p.lat), lng: String(p.lng) });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
