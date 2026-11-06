import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Scope } from '../data/db';
import type { Repository } from '../data/repository';
import type { LatLng } from '../lib/geo';
import type { SyncEngine, SyncState } from '../sync/engine';

export interface AppCtx {
  repo: Repository;
  engine: SyncEngine | null;
  scope: Scope;
  toast: (text: string, kind?: 'ok' | 'error') => void;
  openPoint: (id: string) => void;
  location: GeoState;
}
export const Ctx = createContext<AppCtx>(null as never);
export const useApp = () => useContext(Ctx);

export function useSnapshot() {
  const { repo } = useApp();
  return useSyncExternalStore(repo.subscribe, repo.getSnapshot);
}

const IDLE: SyncState = { phase: 'idle', lastSyncAt: null, message: null };
const noop = () => () => {};
export function useSyncState(engine: SyncEngine | null): SyncState {
  return useSyncExternalStore(engine?.subscribe ?? noop, engine?.getState ?? (() => IDLE));
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return online;
}

export interface GeoReading extends LatLng { accuracyM: number | null; measuredAt: string }

/** Jednorazowy odczyt po świadomym działaniu. Brak watchPosition: żadnego śledzenia. */
export function readPosition(): Promise<GeoReading> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('To urządzenie nie udostępnia lokalizacji.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null, measuredAt: new Date(p.timestamp).toISOString() }),
      (e) => reject(new Error(e.code === 1
        ? 'Brak zgody na lokalizację. Aplikacja działa dalej bez niej.'
        : 'Nie udało się ustalić lokalizacji. Aplikacja działa dalej bez niej.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

export interface GeoState { pos: GeoReading | null; busy: boolean; error: string | null; request: () => Promise<GeoReading | null> }

export function useGeo(): GeoState {
  const [pos, setPos] = useState<GeoReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await readPosition();
      setPos(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { pos, busy, error, request };
}
