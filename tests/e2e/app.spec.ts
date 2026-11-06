import { expect, test } from '@playwright/test';
import { autoDialogs, count, enterDemo, openFromList, stubTiles, tab } from './helpers';

const NAME1 = /Punkt demonstracyjny 4 \(fikcyjny\)/;
const overpass = (elements: unknown[]) => ({ json: { elements } });
const FIRE = [
  { type: 'node', id: 101, lat: 50.1, lon: 19.9, tags: { amenity: 'fire_station', name: 'OSP Pierwsza' } },
  { type: 'way', id: 202, center: { lat: 50.2, lon: 19.8 }, tags: { amenity: 'fire_station' } },
];

test.beforeEach(async ({ context, page }) => {
  await stubTiles(context);
  autoDialogs(page);
});

test('18: działa pod ścieżką GitHub Pages: zasoby, manifest, service worker, odświeżenie zakładki', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('localhost')) errors.push(`${r.status()} ${r.url()}`); });
  await enterDemo(page);
  const manifest = await (await page.request.get('manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: './', scope: './', display: 'standalone' });
  await page.goto('./#/raporty');
  await expect(page.getByRole('heading', { name: 'Postęp' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toMatch(/\/plakaty-test\/$/);
  expect(errors).toEqual([]);
});

test('dane demo są oznaczone i oddzielone od prawdziwej bazy', async ({ page }) => {
  await enterDemo(page);
  await tab(page, 'Lista');
  await expect(page.getByRole('button', { name: NAME1 })).toBeVisible();
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).toEqual(['plakaty-demo']);
});

test('1, 2, 15: wyszukanie, dodanie, ponowne wyszukanie bez duplikatów; awaria nie blokuje wizyt', async ({ page, context }) => {
  let bodies: string[] = [];
  let mode: 'ok' | 'down' = 'down';
  await context.route(/overpass|ovp\.dresel/, (r) => {
    bodies.push(r.request().postData() ?? '');
    return mode === 'ok' ? r.fulfill(overpass(FIRE)) : r.fulfill({ status: 502, body: 'at capacity' });
  });
  await enterDemo(page);
  await tab(page, 'Znajdź');
  await expect(page.getByText('Wyniki pochodzą z OpenStreetMap i mogą być niekompletne')).toBeVisible();
  expect(bodies).toHaveLength(0); // nic bez kliknięcia

  await page.getByRole('button', { name: 'Wyszukaj remizy' }).click();
  await expect(page.getByRole('alert')).toContainText('przeciążone');
  expect(bodies).toHaveLength(3); // po jednej próbie na serwer, bez pętli

  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.getByRole('button', { name: 'Zapisz wizytę', exact: true }).last().click();
  await expect(page.getByText('Zapisano na telefonie').first()).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij' }).click();

  mode = 'ok'; bodies = [];
  await tab(page, 'Znajdź');
  await page.getByRole('button', { name: 'Wyszukaj remizy' }).click();
  await expect(page.getByText('OSP Pierwsza')).toBeVisible();
  await expect(page.getByText('Obiekt bez nazwy w OSM (way/202)')).toBeVisible();
  expect(bodies[0]).toContain('fire_station');
  await page.getByRole('button', { name: /Dodaj wszystkie nowe \(2\)/ }).click();
  await expect(page.getByText('Już w bazie')).toHaveCount(2);

  // Korekta i wizyta w dodanym punkcie.
  await openFromList(page, /OSP Pierwsza/);
  await page.getByRole('button', { name: 'Edytuj' }).click();
  await page.getByLabel('Nazwa').fill('Moja poprawiona nazwa');
  await page.getByRole('button', { name: 'Zapisz punkt' }).click();
  await page.getByRole('button', { name: 'Zamknij' }).click();

  // Ponowne wyszukiwanie: wynik z pamięci i na nowo z sieci.
  await tab(page, 'Znajdź');
  await page.getByRole('button', { name: 'Wyszukaj remizy' }).click();
  await expect(page.getByText('zapamiętane wyniki')).toBeVisible();
  await page.getByRole('button', { name: 'Pobierz na nowo' }).click();
  await expect(page.getByRole('button', { name: /Dodaj wszystkie nowe \(0\)/ })).toBeDisabled();
  await tab(page, 'Lista');
  await expect(page.getByRole('button', { name: /Moja poprawiona nazwa/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /OSP Pierwsza/ })).toHaveCount(0);
  expect(await count(page, 'active')).toBe(14);
});

test('3, 4, 5, 6, 7: punkt ręczny, tablica, nawigacja i aktywny cel', async ({ page, context }) => {
  await context.route('https://www.google.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/html' }));
  await enterDemo(page);
  await page.getByRole('button', { name: 'Dodaj punkt' }).click();
  await page.getByRole('button', { name: 'Użyj tego miejsca' }).click();
  await page.getByLabel('Nazwa').fill('Tablica przy sklepie');
  await page.getByLabel('Miejscowość').fill('Zielonki');
  await page.getByRole('button', { name: 'Zapisz punkt' }).click();
  await expect(page.getByRole('dialog', { name: 'Tablica przy sklepie' })).toBeVisible();

  await page.getByRole('button', { name: 'Edytuj' }).click();
  await page.getByRole('group', { name: 'Lokalizacja obiektu' }).getByLabel('Szerokość').fill('50,1');
  await page.getByRole('group', { name: 'Lokalizacja obiektu' }).getByLabel('Długość').fill('19.9');
  await page.getByRole('group', { name: /tablicy/ }).getByLabel('Szerokość').fill('50.12345');
  await page.getByRole('group', { name: /tablicy/ }).getByLabel('Długość').fill('19.98765');
  await page.getByRole('button', { name: 'Zapisz punkt' }).click();
  await expect(page.getByText(/Google Maps poprowadzi do: lokalizacja tablicy/)).toBeVisible();

  await page.getByRole('button', { name: 'Zamknij' }).click();
  const before = await count(page, 'uniqueVisited');
  expect(before).toBeGreaterThan(0);
  await openFromList(page, /Tablica przy sklepie/);
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('navigate').click()]);
  await popup.waitForURL(/google/);
  const url = new URL(popup.url());
  expect(url.hostname).toBe('www.google.com');
  expect(url.searchParams.get('destination')).toBe('50.12345,19.98765');
  expect(url.searchParams.get('travelmode')).toBe('driving');
  await popup.close();

  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeVisible();
  expect(await count(page, 'uniqueVisited')).toBe(before); // Nawiguj nie zapisuje wizyty

  await page.reload();
  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Aktywny cel' })).toContainText('Tablica przy sklepie');

  const posters = await count(page, 'postersTotal');
  await page.getByRole('region', { name: 'Aktywny cel' }).getByRole('button', { name: 'Plakat powieszony' }).click();
  await page.getByRole('button', { name: 'Więcej' }).click();
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeHidden();
  expect(await count(page, 'postersTotal')).toBe(posters + 2);
  expect(await count(page, 'uniqueVisited')).toBe(before + 1);
});

test('anulowanie dojazdu nie zapisuje wizyty', async ({ page, context }) => {
  await context.route('https://www.google.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/html' }));
  await enterDemo(page);
  const before = await count(page, 'uniqueVisited');
  await openFromList(page, NAME1);
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('navigate').click()]);
  await popup.close();
  await page.getByRole('button', { name: 'Nie byłem / anuluj dojazd' }).click();
  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeHidden();
  expect(await count(page, 'uniqueVisited')).toBe(before);
});

test('8, 12: dane po ponownym otwarciu; korekta i anulowanie zmieniają raport', async ({ page }) => {
  await enterDemo(page);
  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.getByLabel('Notatka (opcjonalnie)').fill('=FORMUŁA("ąę")');
  await page.getByRole('button', { name: 'Zapisz wizytę' }).last().click();
  await expect(page.getByRole('heading', { name: 'Historia wizyt (1)' })).toBeVisible();

  await page.reload();
  const posted = await count(page, 'posted');
  const unique = await count(page, 'uniqueVisited');
  const summary = page.getByTestId('report-summary');
  await expect(summary).toContainText('Wizyty: 1');

  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Popraw' }).click();
  await page.getByRole('radio', { name: 'Wrócić' }).click();
  await page.getByRole('button', { name: 'Zapisz korektę' }).click();
  await expect(page.getByText('Korekty: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij' }).click();
  expect(await count(page, 'posted')).toBe(posted - 1);
  expect(await count(page, 'return')).toBe(2);

  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Anuluj wizytę' }).click();
  await expect(page.locator('.visit.cancelled')).toContainText('Anulowano');
  await page.getByRole('button', { name: 'Zamknij' }).click();
  expect(await count(page, 'uniqueVisited')).toBe(unique - 1);
  await expect(page.getByTestId('report-summary')).toContainText('Wizyty: 0');
  await openFromList(page, NAME1);
  await expect(page.getByRole('heading', { name: 'Historia wizyt (1)' })).toBeVisible();
});

test('13, 14: kopia JSON: eksport, błędny import, przywrócenie po wyczyszczeniu', async ({ page }) => {
  await enterDemo(page);
  const active = await count(page, 'active');
  await tab(page, 'Ustawienia');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Zapisz kopię danych' }).click()]);
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/^plakaty-kopia-.*\.json$/);
  await expect(page.getByText(/Ostatnia kopia: (?!jeszcze)/)).toBeVisible();

  await page.getByTestId('backup-file').setInputFiles({ name: 'zla.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"plakaty-kopia","version":1,"points":[{"id":"x"}],"visits":[]}') });
  await expect(page.getByRole('alert')).toContainText('Punkt 1');
  await page.getByTestId('backup-file').setInputFiles({ name: 'nie.json', mimeType: 'application/json', buffer: Buffer.from('śmieci') });
  await expect(page.getByRole('alert')).toContainText('JSON');
  expect(await count(page, 'active')).toBe(active);

  await tab(page, 'Ustawienia');
  await page.getByTestId('backup-file').setInputFiles(path);
  await expect(page.getByTestId('import-preview')).toContainText('Do dodania: punkty 0, wizyty 0');
  await page.getByRole('button', { name: 'Anuluj' }).click();
});

test('kopii demo nie da się wczytać jako danych produkcyjnych: flaga w pliku', async ({ page }) => {
  await enterDemo(page);
  await tab(page, 'Ustawienia');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Zapisz kopię danych' }).click()]);
  const fs = await import('node:fs/promises');
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(backup.demo).toBe(true);
  expect(backup.points[0].ownerId).toBeUndefined();
});

test('16: brak zgody na GPS nie blokuje mapy, listy ani wizyty', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'denied' } as GeolocationPositionError);
  });
  await enterDemo(page);
  await page.getByRole('button', { name: 'Moja lokalizacja' }).click();
  await expect(page.getByText(/Brak zgody na lokalizację/)).toBeVisible();
  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.getByRole('button', { name: /Dodaj pomiar GPS/ }).click();
  await expect(page.getByText(/Brak zgody na lokalizację/).last()).toBeVisible();
  await page.getByRole('button', { name: 'Zapisz wizytę' }).last().click();
  await expect(page.getByRole('heading', { name: 'Historia wizyt (1)' })).toBeVisible();
});

test('odległości podpisane „w linii prostej”, najbliższe niewykonane', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 50.0, longitude: 19.75 });
  await enterDemo(page);
  await tab(page, 'Lista');
  await page.getByRole('button', { name: 'Najbliższe niewykonane' }).click();
  await expect(page.locator('.point-list li').first()).toContainText('w linii prostej');
  const first = page.locator('.point-list li').first();
  await expect(first).toContainText(/Do odwiedzenia|Wrócić/);
});

test('filtry i wyszukiwanie; symbole oprócz kolorów na mapie', async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(12);
  await expect(page.locator('.leaflet-marker-icon .pin-posted').first()).toHaveText('✓');
  await expect(page.getByText('© ').or(page.getByRole('link', { name: 'OpenStreetMap' })).first()).toBeVisible();
  await tab(page, 'Lista');
  await page.getByLabel('Szukaj').fill('demonstracyjny 12');
  await expect(page.locator('.point-list li')).toHaveCount(1);
  await page.getByLabel('Szukaj').fill('');
  await page.getByRole('button', { name: /Wrócić/ }).first().click();
  await expect(page.locator('.point-list li')).toHaveCount(1);
});

test('archiwizacja zamiast kasowania, punkt do przywrócenia', async ({ page }) => {
  await enterDemo(page);
  const active = await count(page, 'active');
  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Archiwizuj' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await count(page, 'active')).toBe(active - 1);
  await tab(page, 'Ustawienia');
  await page.getByRole('button', { name: /Pokaż zarchiwizowane \(1\)/ }).click();
  await page.getByRole('button', { name: NAME1 }).click();
  await page.getByRole('button', { name: 'Przywróć z archiwum' }).click();
  await page.getByRole('button', { name: 'Zamknij' }).click();
  expect(await count(page, 'active')).toBe(active);
});

test('import punktów CSV: podgląd, błędy, zamienione współrzędne', async ({ page }) => {
  await enterDemo(page);
  await tab(page, 'Ustawienia');
  const csv = '﻿nazwa;lat;lng;rejon\nŁąka;50,2;19,9;Zachód\nZamiana;19.9;50.3;\nZły;abc;20;\n';
  await page.getByTestId('points-file').setInputFiles({ name: 'p.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('points-preview')).toContainText('Poprawne: 1');
  await expect(page.getByTestId('points-preview')).toContainText('Błędne: 2');
  await page.getByLabel('Zamień szerokość i długość miejscami').check();
  await expect(page.getByTestId('points-preview')).toContainText('Poprawne: 2');
});

test('raport CSV: pobranie zgodne z filtrem, polskie znaki', async ({ page }) => {
  await enterDemo(page);
  await openFromList(page, NAME1);
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.getByLabel('Notatka (opcjonalnie)').fill('=2+2 żółć');
  await page.getByRole('button', { name: 'Zapisz wizytę' }).last().click();
  await expect(page.getByRole('heading', { name: 'Historia wizyt (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij' }).click();
  await tab(page, 'Raporty');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Eksportuj CSV' }).click()]);
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(await dl.path(), 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("'=2+2 żółć");
  expect(text.trim().split('\r\n')).toHaveLength(2);
});

test('karta aktywnego celu zwija się, a widok wydruku ukrywa nawigację', async ({ page, context }) => {
  await context.route('https://www.google.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/html' }));
  await enterDemo(page);
  await openFromList(page, NAME1);
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('navigate').click()]);
  await popup.close();
  await page.getByRole('button', { name: 'Zwiń' }).click();
  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeHidden();
  await page.getByRole('button', { name: 'Rozwiń' }).click();
  await expect(page.getByText('Czy udało się rozwiesić plakat?')).toBeVisible();
  await tab(page, 'Raporty');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.tabbar')).toBeHidden();
  await expect(page.locator('.active-target')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Raport wizyt' })).toBeVisible();
});
