import { useState } from 'react';
import { useSnapshot } from './hooks';

const DAYS = 7;
const SNOOZE = 'plakaty-backup-snooze';

export function backupOverdue(last: string | null, now = Date.now()) {
  return !last || now - Date.parse(last) > DAYS * 86400_000;
}

export function BackupReminder({ onOpen }: { onOpen: () => void }) {
  const { lastBackupAt, visits, activeTarget } = useSnapshot();
  const [hidden, setHidden] = useState(() => Date.now() < Number(localStorage.getItem(SNOOZE) ?? 0));
  if (hidden || activeTarget || !visits.length || !backupOverdue(lastBackupAt)) return null;
  return (
    <div className="reminder">
      <span>{lastBackupAt ? `Ostatnia kopia ponad ${DAYS} dni temu.` : 'Nie masz jeszcze kopii danych.'}</span>
      <button className="btn tiny" onClick={onOpen}>Zapisz kopię</button>
      <button className="btn tiny" onClick={() => { localStorage.setItem(SNOOZE, String(Date.now() + 3 * 86400_000)); setHidden(true); }}>Później</button>
    </div>
  );
}
