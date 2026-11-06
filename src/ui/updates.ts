import { registerSW } from 'virtual:pwa-register';

let needRefresh = false;
let apply: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Nowa wersja czeka na zgodę użytkownika. Dane w IndexedDB nie są przez nią dotykane. */
export function setupUpdates() {
  if (!import.meta.env.PROD) return;
  const update = registerSW({
    onNeedRefresh() { needRefresh = true; listeners.forEach((l) => l()); },
  });
  apply = () => void update(true);
}
export const updates = {
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  get: () => needRefresh,
  apply: () => apply?.(),
};
