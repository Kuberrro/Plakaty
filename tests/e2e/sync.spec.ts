import { expect, test } from '@playwright/test';
import { autoDialogs, count, login, MockSupabase, openFromList, stubTiles, tab } from './helpers';

async function addPoint(page: import('@playwright/test').Page, name: string) {
  await tab(page, 'Mapa');
  await page.getByRole('button', { name: 'Dodaj punkt' }).click();
  await page.getByRole('button', { name: 'Użyj tego miejsca' }).click();
  await page.getByLabel('Nazwa').fill(name);
  await page.getByRole('button', { name: 'Zapisz punkt' }).click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
}
async function addVisit(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.getByRole('button', { name: 'Zapisz wizytę' }).last().click();
  await expect(page.getByRole('heading', { name: /Historia wizyt \(1\)/ })).toBeVisible();
}
const closeSheet = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Zamknij' }).click();

let api: MockSupabase;
test.beforeEach(async ({ context, page }) => {
  await stubTiles(context);
  autoDialogs(page);
  api = new MockSupabase();
  await api.attach(context);
});

test('9, 10, 19: offline zapis, przeładowanie, „aktualizacja”, wysyłka raz', async ({ page, context }) => {
  await login(page, 'a@test.pl');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // service worker przejmuje stronę
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await addPoint(page, 'Punkt offline');
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  expect(api.points.size).toBe(1);

  await context.setOffline(true);
  await expect(page.getByTestId('statusbar')).toContainText('Offline');
  await openFromList(page, /Punkt offline/);
  await addVisit(page);
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Oczekuje na synchronizację: 1');
  expect(api.visits.size).toBe(0);

  // Start bez internetu z cache interfejsu; dane i kolejka na miejscu.
  await page.reload();
  await expect(page.getByTestId('statusbar')).toContainText('Oczekuje na synchronizację: 1');
  expect(await count(page, 'uniqueVisited')).toBe(1);

  // Odpowiednik aktualizacji aplikacji: nowy service worker i pusty cache interfejsu.
  await context.setOffline(false);
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await context.setOffline(true);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  expect(await count(page, 'uniqueVisited')).toBe(1);
  expect(api.visits.size).toBe(1);
  const writes = api.writes;

  await page.getByRole('button', { name: 'Synchronizuj' }).click();
  await page.getByRole('button', { name: 'Synchronizuj' }).click();
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  expect(api.visits.size).toBe(1);
  expect(api.writes).toBe(writes);
});

test('10: zerwana odpowiedź przy wysyłce wizyty nie tworzy duplikatu', async ({ page }) => {
  await login(page, 'a@test.pl');
  await addPoint(page, 'Punkt P');
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  api.loseNextResponse = 'visits'; // serwer zapisze, a odpowiedź zginie
  await openFromList(page, /Punkt P/);
  await addVisit(page);
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Błąd połączenia');
  await expect.poll(() => api.visits.size).toBe(1);
  await page.getByRole('button', { name: 'Synchronizuj' }).click();
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  expect(api.visits.size).toBe(1);
});

test('11: świeża przeglądarka po zalogowaniu pobiera dane z chmury', async ({ page, browser }) => {
  await login(page, 'a@test.pl');
  await addPoint(page, 'Punkt chmurowy');
  await addVisit(page);
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');

  const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 } });
  await stubTiles(fresh);
  await api.attach(fresh);
  const p2 = await fresh.newPage();
  await login(p2, 'a@test.pl');
  await tab(p2, 'Lista');
  await expect(p2.getByRole('button', { name: /Punkt chmurowy/ })).toBeVisible();
  await expect(p2.getByRole('button', { name: /Punkt chmurowy/ })).toContainText('Plakat powieszony');
  await fresh.close();
});

test('20: przełączenie kont nie ujawnia danych; kolejka wraca do właściciela', async ({ page, context }) => {
  await login(page, 'a@test.pl');
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  await context.setOffline(true);
  await addPoint(page, 'Tajny punkt A');
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Oczekuje na synchronizację: 1');

  let warned = '';
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { warned = d.message(); return d.accept(); });
  await tab(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj się' })).toBeVisible();
  expect(warned).toContain('nie wysłano');

  await context.setOffline(false);
  await login(page, 'b@test.pl');
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  await tab(page, 'Lista');
  await expect(page.getByText('Tajny punkt A')).toHaveCount(0);
  expect(api.points.size).toBe(0); // kolejka A nie poszła z konta B
  await expect(page.locator('.point-list li')).toHaveCount(0);

  await tab(page, 'Ustawienia');
  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await login(page, 'a@test.pl');
  await expect(page.getByTestId('statusbar')).toContainText('Zapisano w chmurze');
  await expect.poll(() => [...api.points.values()].map((r) => r.user_id as string)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
});

test('wygasła sesja przy starcie offline nie blokuje pracy', async ({ page, context }) => {
  await login(page, 'a@test.pl');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => {
    const k = 'plakaty-auth';
    const s = JSON.parse(localStorage.getItem(k)!);
    s.expires_at = 1;
    localStorage.setItem(k, JSON.stringify(s));
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('statusbar')).toContainText('Offline');
  await addPoint(page, 'Praca bez sesji');
  await closeSheet(page);
  await expect(page.getByTestId('statusbar')).toContainText('Oczekuje na synchronizację: 1');
});

test('zły login: czytelny komunikat', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('E-mail').fill('x@test.pl');
  await page.getByLabel('Hasło').fill('zle');
  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('alert')).toContainText('Nieprawidłowy');
});
