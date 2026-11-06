import type L from 'leaflet';
import { useRef, useState } from 'react';
import { BaseMap } from './BaseMap';

interface Props {
  title: string;
  start: { lat: number; lng: number };
  onPick: (p: { lat: number; lng: number }) => void;
  onCancel: () => void;
}

/** Wybór miejsca: krzyżyk na środku; przesuń mapę albo stuknij w miejsce. */
export function CoordPicker({ title, start, onPick, onCancel }: Props) {
  const map = useRef<L.Map | null>(null);
  const [pos, setPos] = useState(start);
  return (
    <div className="overlay picker" role="dialog" aria-label={title}>
      <header className="sheet-head"><strong>{title}</strong></header>
      <div className="picker-map">
        <BaseMap
          center={[start.lat, start.lng]}
          zoom={15}
          onReady={(m) => {
            map.current = m;
            m.on('move', () => { const c = m.getCenter(); setPos({ lat: c.lat, lng: c.lng }); });
            m.on('click', (e: L.LeafletMouseEvent) => m.panTo(e.latlng));
          }}
        />
        <div className="crosshair" aria-hidden>+</div>
      </div>
      <div className="picker-foot stack">
        <p className="small muted">Przesuń mapę tak, aby krzyżyk wskazywał miejsce. {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</p>
        <div className="row">
          <button className="btn primary grow" onClick={() => onPick({ lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6) })}>Użyj tego miejsca</button>
          <button className="btn" onClick={onCancel}>Anuluj</button>
        </div>
      </div>
    </div>
  );
}
