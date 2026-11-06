import { test } from '@playwright/test';
import { autoDialogs, enterDemo, openFromList, stubTiles, tab } from './helpers';

// Ręczny przegląd wyglądu: SCREENS=katalog npx playwright test screens
test.skip(!process.env.SCREENS, 'tylko na żądanie');
test('zrzuty', async ({ page, context }) => {
  const dir = process.env.SCREENS!;
  await stubTiles(context);
  await context.route('https://www.google.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/html' }));
  autoDialogs(page);
  await context.route(/overpass/, (r) => r.fulfill({ json: { elements: [
    { type: 'node', id: 1, lat: 50.1, lon: 19.9, tags: { name: 'Przykład A', 'addr:city': 'Testowo' } },
    { type: 'way', id: 2, center: { lat: 50.1002, lon: 19.9001 }, tags: {} },
  ] } }));
  await page.goto('./');
  await page.screenshot({ path: `${dir}/1-login.png` });
  await enterDemo(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/2-mapa.png` });
  await tab(page, 'Lista');
  await page.screenshot({ path: `${dir}/3-lista.png` });
  await openFromList(page, /demonstracyjny 2 /);
  await page.getByRole('button', { name: 'Zapisz wizytę' }).click();
  await page.screenshot({ path: `${dir}/4-karta.png` });
  await page.getByRole('button', { name: 'Zamknij' }).click();
  await tab(page, 'Znajdź');
  await page.getByRole('button', { name: 'Wyszukaj remizy' }).click();
  await page.getByText('Przykład A').first().waitFor();
  await page.screenshot({ path: `${dir}/5-znajdz.png`, fullPage: false });
  await tab(page, 'Raporty');
  await page.screenshot({ path: `${dir}/6-raporty.png` });
  await tab(page, 'Ustawienia');
  await page.screenshot({ path: `${dir}/7-ustawienia.png` });
  await tab(page, 'Lista');
  await page.locator('.point-list button').nth(2).click();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('navigate').click()]);
  await popup.close();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/8-cel.png` });
});
