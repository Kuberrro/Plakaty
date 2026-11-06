import { useSyncExternalStore } from 'react';
import { formatDateTime } from '../lib/time';
import { useApp, useOnline, useSnapshot, useSyncState } from './hooks';
import { updates } from './updates';

export function StatusBar() {
  const { engine, scope } = useApp();
  const { outbox } = useSnapshot();
  const online = useOnline();
  const sync = useSyncState(engine);
  const hasUpdate = useSyncExternalStore(updates.subscribe, updates.get);
  const pending = outbox.size;
  const failed = [...outbox.values()].filter((o) => o.lastError).length;

  let label: string;
  let tone = 'ok';
  if (scope.kind !== 'user') {
    label = 'Zapisano na telefonie (bez chmury)';
  } else if (sync.phase === 'syncing') {
    label = 'Synchronizuję…';
  } else if (sync.phase === 'auth') {
    label = sync.message ?? 'Zaloguj się ponownie'; tone = 'bad';
  } else if (sync.phase === 'error' || failed) {
    label = sync.message ?? `Błąd synchronizacji (${failed})`; tone = 'bad';
  } else if (pending) {
    label = `Oczekuje na synchronizację: ${pending}`; tone = 'warn';
  } else if (sync.lastSyncAt) {
    label = `Zapisano w chmurze (${formatDateTime(sync.lastSyncAt)})`;
  } else {
    label = 'Jeszcze nie synchronizowano'; tone = 'warn';
  }

  return (
    <>
      <div className={`statusbar ${tone}`} data-testid="statusbar">
        <span className={`dot ${online ? 'on' : 'off'}`} aria-hidden />
        <span className="net">{online ? 'Online' : 'Offline'}</span>
        <span className="label" role="status">{label}</span>
        {engine && (
          <button className="btn tiny" disabled={!online || sync.phase === 'syncing'} onClick={() => void engine.sync()}>Synchronizuj</button>
        )}
      </div>
      {hasUpdate && (
        <div className="update-bar">
          Dostępna nowa wersja. Twoje dane i kolejka zostają.
          <button className="btn tiny" onClick={updates.apply}>Odśwież</button>
        </div>
      )}
    </>
  );
}
