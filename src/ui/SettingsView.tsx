import { useRef, useState } from 'react';
import { createBackup, ImportError, MAX_IMPORT_BYTES, parseBackup, planImport, type ImportPlan } from '../io/backup';
import { pointsGeoJson } from '../io/exports';
import { parsePointsCsv, parsePointsGeoJson, planPointsImport, type PointsParse, type PointsPlan } from '../io/importPoints';
import { saveFile } from '../io/share';
import { formatDateTime, warsawDay } from '../lib/time';
import type { ConflictCopy, Point, Visit } from '../lib/types';
import { useApp, useSnapshot, useSyncState } from './hooks';

const BASE = import.meta.env.BASE_URL;

function conflictName(c: ConflictCopy) {
  return c.entity === 'point'
    ? (c.version as Point).name
    : `Wizyta ${formatDateTime((c.version as Visit).visitedAt)}`;
}
const ORIGIN = { cloud: 'z chmury', device: 'z telefonu', import: 'z pliku kopii' };

function Conflicts() {
  const { repo, toast } = useApp();
  const { conflicts } = useSnapshot();
  if (!conflicts.length) return null;
  return (
    <section className="card stack">
      <h3>Konflikty ({conflicts.length})</h3>
      <p className="small muted">Nieaktywne wersje rekordów. Możesz przywrócić wersję albo ją odrzucić.</p>
      <ul className="plain">{conflicts.map((c) => (
        <li key={c.id} className="stack">
          <div><strong>{conflictName(c)}</strong> <span className="small muted">wersja {ORIGIN[c.origin]}, {formatDateTime(c.at)}</span></div>
          <div className="row">
            <button className="btn tiny" onClick={async () => {
              if (!window.confirm('Zastąpić obecną wersję tą wersją?')) return;
              const updatedAt = new Date().toISOString();
              const cur = repo.getEntity(c.entity, c.entityId);
              const base = { ownerId: repo.ownerId, updatedAt, serverRev: cur?.serverRev ?? null };
              try {
                await repo.commit(c.entity === 'point'
                  ? { points: [{ ...(c.version as Point), ...base }] }
                  : { visits: [{ ...(c.version as Visit), ...base }] });
                await repo.dismissConflict(c.id);
                toast('Przywrócono wersję');
              } catch { toast('Nie udało się zapisać', 'error'); }
            }}>Przywróć tę wersję</button>
            <button className="btn tiny" onClick={async () => {
              if (window.confirm('Odrzucić tę wersję na stałe?')) await repo.dismissConflict(c.id);
            }}>Odrzuć</button>
          </div>
        </li>
      ))}</ul>
    </section>
  );
}

function BackupSection() {
  const { repo, scope, toast } = useApp();
  const snapshot = useSnapshot();
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function save() {
    if (!window.confirm('Plik kopii zawiera lokalizacje i notatki. Przechowuj go prywatnie i nie wrzucaj do publicznych miejsc. Kontynuować?')) return;
    try {
      const text = JSON.stringify(createBackup(snapshot, new Date(), scope.kind === 'demo'), null, 1);
      const ok = await saveFile(`plakaty-kopia-${warsawDay(new Date())}.json`, text, 'application/json');
      if (ok) { await repo.setLastBackup(new Date().toISOString()); toast('Kopia gotowa'); }
    } catch { toast('Nie udało się zapisać kopii', 'error'); }
  }

  async function pick(file: File | undefined) {
    setErrors([]); setPlan(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setErrors(['Plik jest zbyt duży.']); return; }
    try {
      const parsed = parseBackup(await file.text());
      if (parsed.demo && scope.kind !== 'demo') { setErrors(['To kopia z trybu demonstracyjnego. Nie można jej wczytać do prawdziwych danych.']); return; }
      setPlan(planImport(parsed, repo.getSnapshot(), repo.ownerId));
    } catch (e) {
      setErrors(e instanceof ImportError ? e.errors : ['Nie udało się odczytać pliku.']);
    }
  }

  async function apply() {
    try {
      await repo.commit({ points: plan!.newPoints, visits: plan!.newVisits, conflicts: plan!.conflicts });
      toast(`Przywrócono: ${plan!.newPoints.length + plan!.newVisits.length}`);
      setPlan(null);
    } catch { toast('Import nie powiódł się, dane bez zmian', 'error'); }
  }

  return (
    <section className="card stack">
      <h3>Kopia danych</h3>
      <p className="small">Ostatnia kopia: {snapshot.lastBackupAt ? formatDateTime(snapshot.lastBackupAt) : 'jeszcze nie wykonano'}</p>
      <button className="btn primary" onClick={save}>Zapisz kopię danych</button>
      <p className="small muted">Plik może zawierać prywatne lokalizacje i notatki. Raport CSV nie zastępuje tej kopii.</p>
      <label className="btn file-btn">Przywróć z kopii…
        <input ref={input} data-testid="backup-file" type="file" accept=".json,application/json" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {errors.length > 0 && <ErrorList errors={errors} />}
      {plan && (
        <div className="stack notice">
          <p data-testid="import-preview">Do dodania: punkty {plan.newPoints.length}, wizyty {plan.newVisits.length}. Identyczne (pominięte): {plan.identical}.
            {' '}Różniące się: {plan.conflicts.length} (zostanie obecna wersja, wersja z pliku trafi do konfliktów).
            {plan.orphanVisits > 0 && ` Wizyty bez punktu (pominięte): ${plan.orphanVisits}.`} Nic nie zostanie usunięte.</p>
          <div className="row">
            <button className="btn primary grow" onClick={apply}>Zatwierdź import</button>
            <button className="btn" onClick={() => setPlan(null)}>Anuluj</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div className="error-text small" role="alert">
      <p>Problemy ({errors.length}):</p>
      <ul>{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
      {errors.length > 8 && <p>…i {errors.length - 8} kolejnych.</p>}
    </div>
  );
}

function PointsIo() {
  const { repo, toast } = useApp();
  const { points, statuses } = useSnapshot();
  const [source, setSource] = useState<{ text: string; geo: boolean } | null>(null);
  const [swap, setSwap] = useState(false);
  const [parsed, setParsed] = useState<PointsParse | null>(null);
  const [plan, setPlan] = useState<PointsPlan | null>(null);

  function run(text: string, geo: boolean, sw: boolean) {
    let r: PointsParse;
    try { r = geo ? parsePointsGeoJson(text, sw) : parsePointsCsv(text, sw); }
    catch (e) { r = { rows: [], errors: [(e as Error).message], swapped: 0 }; }
    setParsed(r);
    setPlan(planPointsImport(r.rows, repo.getSnapshot().points, repo.ownerId));
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const geo = /\.(geo)?json$/i.test(file.name);
    setSource({ text, geo });
    setSwap(false);
    run(text, geo, false);
  }

  return (
    <section className="card stack">
      <h3>Import i eksport punktów</h3>
      <label className="btn file-btn">Importuj punkty (CSV lub GeoJSON)…
        <input data-testid="points-file" type="file" accept=".csv,.geojson,.json,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <p className="small">Szablony: <a href={`${BASE}szablony/punkty.csv`} download>punkty.csv</a>, <a href={`${BASE}szablony/punkty.geojson`} download>punkty.geojson</a>. Opis kolumn: README.</p>
      {parsed && plan && (
        <div className="stack notice">
          <p data-testid="points-preview">Poprawne: {parsed.rows.length}. Nowe: {plan.create.length}. Duplikaty (pominięte): {plan.duplicates}. Błędne: {parsed.errors.length}.</p>
          {parsed.errors.length > 0 && <ErrorList errors={parsed.errors} />}
          {(parsed.swapped > 0 || swap) && (
            <label className="inline"><input type="checkbox" checked={swap} onChange={(e) => { setSwap(e.target.checked); run(source!.text, source!.geo, e.target.checked); }} /> Zamień szerokość i długość miejscami</label>
          )}
          <div className="row">
            <button className="btn primary grow" disabled={!plan.create.length} onClick={async () => {
              try { await repo.commit({ points: plan.create }); toast(`Zapisano na telefonie: ${plan.create.length}`); setParsed(null); setPlan(null); }
              catch { toast('Import nie powiódł się, dane bez zmian', 'error'); }
            }}>Dodaj {plan.create.length} punktów</button>
            <button className="btn" onClick={() => { setParsed(null); setPlan(null); }}>Anuluj</button>
          </div>
        </div>
      )}
      <button className="btn" disabled={!points.length} onClick={() => saveFile(`plakaty-punkty-${warsawDay(new Date())}.geojson`, pointsGeoJson(points, statuses), 'application/geo+json').catch(() => toast('Nie udało się zapisać pliku', 'error'))}>Eksportuj punkty GeoJSON</button>
    </section>
  );
}

export function SettingsView({ onLeave, onResetDemo, onShowArchive }: { onLeave: () => Promise<void>; onResetDemo: () => void; onShowArchive: () => void }) {
  const { scope, engine } = useApp();
  const { outbox, points } = useSnapshot();
  const sync = useSyncState(engine);
  const archived = points.filter((p) => p.archivedAt).length;

  async function logout() {
    const n = outbox.size;
    const msg = n
      ? `UWAGA: ${n} zmian nie wysłano do chmury. Pozostaną na tym urządzeniu i wyślą się po ponownym zalogowaniu na TO konto. Wylogować mimo to?`
      : 'Wylogować? Dane konta zostaną na tym urządzeniu, ale będą niedostępne do czasu ponownego logowania.';
    if (window.confirm(msg)) await onLeave();
  }

  return (
    <div className="scroll pad stack">
      <h2>Ustawienia</h2>
      <section className="card stack">
        <h3>Konto</h3>
        {scope.kind === 'user' && <p data-testid="account">Zalogowano: {scope.email}</p>}
        {scope.kind === 'local' && <p>Tryb lokalny: dane tylko na tym urządzeniu.</p>}
        {scope.kind === 'demo' && <p>Tryb demonstracyjny: dane fikcyjne.</p>}
        {sync.lastSyncAt && <p className="small">Ostatnia synchronizacja: {formatDateTime(sync.lastSyncAt)}</p>}
        <p className="small muted">Synchronizacja działa, gdy aplikacja jest otwarta. iPhone nie wysyła danych w tle.</p>
        {scope.kind === 'user' && <button className="btn" onClick={logout}>Wyloguj</button>}
        {scope.kind === 'local' && <button className="btn" onClick={() => void onLeave()}>Zamknij tryb lokalny</button>}
        {scope.kind === 'demo' && (
          <div className="row wrap">
            <button className="btn" onClick={() => void onLeave()}>Zakończ demo</button>
            <button className="btn" onClick={() => { if (window.confirm('Przywrócić dane demonstracyjne do stanu początkowego?')) onResetDemo(); }}>Resetuj demo</button>
          </div>
        )}
      </section>
      <Conflicts />
      <BackupSection />
      <PointsIo />
      <section className="card stack">
        <h3>Archiwum</h3>
        <button className="btn" onClick={onShowArchive}>Pokaż zarchiwizowane ({archived})</button>
      </section>
      <section className="card stack small">
        <h3>Informacje</h3>
        <p>Podkład i dane remiz: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">współtwórcy OpenStreetMap</a> (ODbL). <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Zgłoś błąd mapy</a>.</p>
        <p>Mapa i wyszukiwanie remiz wymagają internetu. Odległości są liczone w linii prostej. Czas w raportach: Europe/Warsaw.</p>
      </section>
    </div>
  );
}
