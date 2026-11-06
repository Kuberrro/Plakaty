import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyFilters, type Filters } from '../lib/filters';
import { KRAKOW } from '../osm/overpass';
import { STATUS_LABEL, STATUS_SYMBOL, type PointStatus } from '../lib/types';
import { BaseMap, statusIcon } from './BaseMap';
import { CoordPicker } from './CoordPicker';
import { FilterBar } from './FilterBar';
import { useApp, useSnapshot } from './hooks';
import { PointForm } from './PointForm';

/** Widok mapy żyje między przełączeniami zakładek, ale nie jest zapisywany na stałe. */
let lastView: { center: [number, number]; zoom: number } | null = null;

export function MapView({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { openPoint, location } = useApp();
  const { points, statuses } = useSnapshot();
  const [map, setMap] = useState<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const me = useRef<L.Layer | null>(null);
  const fitted = useRef(!!lastView);
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState<'pick' | { lat: number; lng: number } | null>(null);

  const shown = useMemo(() => applyFilters(points, statuses, filters), [points, statuses, filters]);

  useEffect(() => {
    if (!map) return;
    layer.current ??= L.layerGroup().addTo(map);
    layer.current.clearLayers();
    for (const p of shown) {
      const s = statuses.get(p.id) ?? 'todo';
      L.marker([p.lat, p.lng], { icon: statusIcon(s, STATUS_SYMBOL[s]), title: `${p.name}: ${STATUS_LABEL[s]}`, alt: `${p.name}: ${STATUS_LABEL[s]}` })
        .on('click', () => openPoint(p.id))
        .addTo(layer.current);
    }
    if (!fitted.current && shown.length) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(shown.map((p) => [p.lat, p.lng])).pad(0.15), { maxZoom: 13 });
    }
  }, [map, shown, statuses, openPoint]);

  useEffect(() => {
    if (!map || !location.pos) return;
    me.current?.remove();
    me.current = L.circleMarker([location.pos.lat, location.pos.lng], { radius: 9, color: '#1d4ed8', fillOpacity: 0.8, weight: 3 })
      .bindTooltip('Twoja lokalizacja').addTo(map);
  }, [map, location.pos]);

  async function locate() {
    const r = await location.request();
    if (r) map?.setView([r.lat, r.lng], 13);
  }

  return (
    <div className="map-view">
      <BaseMap
        center={lastView?.center ?? [KRAKOW.lat, KRAKOW.lng]}
        zoom={lastView?.zoom ?? 10}
        onReady={(m) => {
          layer.current = null;
          setMap(m);
          m.on('moveend', () => { const c = m.getCenter(); lastView = { center: [c.lat, c.lng], zoom: m.getZoom() }; });
        }}
      />
      <div className="map-actions">
        <button className="btn tiny" onClick={() => setShowFilters((x) => !x)}>Filtry{filters.statuses.length || filters.region || filters.query ? ' •' : ''}</button>
        <button className="btn tiny" disabled={location.busy} onClick={locate}>{location.busy ? 'Szukam…' : 'Moja lokalizacja'}</button>
        <button className="btn tiny primary" onClick={() => setAdding('pick')}>Dodaj punkt</button>
      </div>
      {location.error && <div className="map-note" role="status">{location.error}</div>}
      {showFilters && <div className="map-filters"><FilterBar value={filters} onChange={setFilters} /></div>}
      <div className="legend" aria-label="Legenda">
        {(['todo', 'posted', 'return', 'impossible'] as PointStatus[]).map((s) => (
          <span key={s}><span className={`pin mini pin-${s}`} aria-hidden>{STATUS_SYMBOL[s]}</span>{STATUS_LABEL[s]}</span>
        ))}
      </div>
      {adding === 'pick' && (
        <CoordPicker
          title="Wskaż miejsce nowego punktu"
          start={location.pos ?? (map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : KRAKOW)}
          onPick={setAdding}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding && adding !== 'pick' && (
        <PointForm initial={adding} onClose={(id) => { setAdding(null); if (id) openPoint(id); }} />
      )}
    </div>
  );
}
