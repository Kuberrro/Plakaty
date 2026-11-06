import L from 'leaflet';
import { useEffect, useRef } from 'react';

const TILE_URL = (import.meta.env.VITE_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

interface Props { center: [number, number]; zoom: number; onReady: (m: L.Map) => void; className?: string }

/** Tylko kafelki oglądanego widoku, przez zwykły cache przeglądarki. Bez pobierania obszarów. */
export function BaseMap({ center, zoom, onReady, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    const map = L.map(el.current!, { center, zoom, zoomControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    ready.current(map);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    return () => { ro.disconnect(); map.remove(); };
    // Mapa powstaje raz; dalej sterują nią dzieci przez instancję.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={el} className={className ?? 'map'} data-testid="map" />;
}

export const statusIcon = (status: string, symbol: string) =>
  L.divIcon({ className: '', html: `<div class="pin pin-${status}">${symbol}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
