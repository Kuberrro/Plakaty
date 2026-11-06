# Plakaty

Prywatna aplikacja internetowa na iPhone'a do wyszukiwania remiz w okolicach Krakowa, planowania ich odwiedzania i rejestrowania rozwieszania plakatów. Aplikacja jest głównym źródłem danych; Google Maps służy tylko do nawigacji.

- **Wdrożenie krok po kroku:** [docs/WDROZENIE.md](docs/WDROZENIE.md)
- **Testy na iPhonie:** [docs/TESTY-RECZNE.md](docs/TESTY-RECZNE.md)

## Technologie

React, TypeScript, Vite, Leaflet, podkład OpenStreetMap, Overpass API, Supabase (logowanie i PostgreSQL), IndexedDB, service worker, GitHub Pages. Bez Google API, modeli AI i abonamentu.

## Uruchomienie lokalne

Potrzebny Node.js 22 lub nowszy.

```bash
npm install
```

```bash
npm run dev
```

Otwórz adres z terminala. Bez konfiguracji działają tryb lokalny i demonstracyjny. Aby włączyć chmurę, skopiuj `.env.example` do `.env.local` i uzupełnij dwa parametry.

| Polecenie | Co robi |
|---|---|
| `npm test` | testy jednostkowe |
| `npm run test:rls` | RLS na tymczasowym lokalnym Postgresie (wymaga zainstalowanego Postgresa) |
| `npm run test:e2e` | testy w Chrome (rozmiar iPhone'a, ścieżka jak na GitHub Pages) |
| `npm run test:rls:live` | RLS na prawdziwym projekcie Supabase |
| `npm run build` | sprawdzenie typów, build, kontrola sekretów |

## Tryby pracy

| Tryb | Kiedy | Gdzie są dane |
|---|---|---|
| Konto | Supabase skonfigurowany, po zalogowaniu | IndexedDB `plakaty-<id konta>` + chmura |
| Lokalny | Supabase nieskonfigurowany | IndexedDB `plakaty-local`, tylko to urządzenie |
| Demonstracyjny | przycisk na ekranie startowym | IndexedDB `plakaty-demo`, dane fikcyjne, bez chmury |

Kopii z trybu demonstracyjnego nie da się wczytać do prawdziwych danych.

## Reguły danych

**Status punktu** nie jest przechowywany. To zawsze wynik najnowszej nieanulowanej wizyty (wg czasu wizyty; przy remisie później utworzona). Brak takiej wizyty oznacza „do odwiedzenia”. Reguła jest w [src/lib/status.ts](src/lib/status.ts), a jej odpowiednik w widoku SQL `point_status`. Dlatego korekty i anulowania same poprawiają status i raporty.

**Liczniki:**

| Licznik | Znaczenie |
|---|---|
| Aktywne punkty | punkty niezarchiwizowane |
| Unikalne odwiedzone | aktywne punkty z co najmniej jedną nieanulowaną wizytą; kilka wizyt liczy się raz |
| Statusy | aktualny status aktywnych punktów |
| Suma plakatów | plakaty z nieanulowanych wizyt, także w punktach później zarchiwizowanych |

Wizyta to zdarzenie, punkt to miejsce, plakaty to sztuki. Daty raportów to dni kalendarzowe w strefie Europe/Warsaw.

**Aplikacja nie mierzy** tras, kilometrów ani czasu jazdy. Odległości są liczone w linii prostej. Czas między „Nawiguj” a wizytą nie jest czasem przejazdu.

## Zapis i synchronizacja

1. Każda zmiana to jedna transakcja IndexedDB: rekord i wpis w kolejce. Potwierdzenie pojawia się dopiero po jej zatwierdzeniu. Przy błędzie formularz zostaje otwarty.
2. Wysyłka rusza przy starcie, po powrocie sieci, po powrocie do aplikacji, po zmianie danych (z krótkim opóźnieniem) i przyciskiem „Synchronizuj”. Działa tylko przy otwartej aplikacji: iOS nie synchronizuje w tle.
3. Najpierw wysyłka, potem pobranie. Pobranie nigdy nie nadpisuje niewysłanej zmiany.
4. Powtórzenia są bezpieczne: rekordy mają stałe UUID, a każda zmiana ma identyfikator operacji zapisywany w chmurze. Utracona odpowiedź serwera nie tworzy duplikatu ani fałszywego konfliktu.
5. Rekord odrzucony przez serwer zostaje na telefonie z komunikatem błędu i nie blokuje pozostałych.

**Polityka konfliktów:** gdy ten sam rekord zmieniono na dwóch urządzeniach, wygrywa wersja z późniejszym czasem edycji, a przegrana trafia do Ustawienia → Konflikty, skąd można ją przywrócić lub odrzucić. Czasy pochodzą z zegarów urządzeń. Aplikacja nie ma trwałego kasowania punktów ani wizyt. Wiersz usunięty ręcznie w panelu Supabase nie zniknie z telefonu.

**Konta:** każde konto ma osobną bazę i kolejkę na urządzeniu. Wysyłka zostaje przerwana, jeśli zalogowane konto nie jest właścicielem danych. Po wylogowaniu dane konta zostają na urządzeniu (niedostępne w aplikacji do ponownego logowania), bo mogą zawierać niewysłane zmiany. Nie są szyfrowane.

## Bezpieczeństwo

- Przeglądarka dostaje tylko URL projektu i klucz publishable. Dane chroni logowanie i RLS, a nie tajność adresu.
- Klucz `sb_secret_` nigdy nie może trafić do aplikacji. Aplikacja go odrzuca, a build przerywa się, gdy znajdzie sekret w plikach wynikowych.
- RLS: [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql). Klucz obcy `(user_id, point_id)` sprawia, że wizyta nie może wskazać cudzego punktu.
- Repozytorium nie może zawierać eksportów danych; `.gitignore` blokuje ich standardowe nazwy.

## Import punktów

Szablony: [public/szablony/punkty.csv](public/szablony/punkty.csv), [public/szablony/punkty.geojson](public/szablony/punkty.geojson) (także w Ustawieniach).

| Kolumna CSV | Wymagana | Opis |
|---|---|---|
| `nazwa` | tak | nazwa miejsca |
| `lat` | tak | szerokość, np. `50.0614` lub `50,0614` |
| `lng` | tak | długość, np. `19.9366` |
| `typ` | nie | `remiza`, `tablica` lub `inne` (domyślnie) |
| `miejscowosc`, `adres`, `rejon`, `notatka` | nie | tekst |
| `tablica_lat`, `tablica_lng` | nie | oba albo żaden |
| `id_zrodlowe` | nie | stały identyfikator; zapobiega duplikatom przy ponownym imporcie |

Separator `;` lub `,` jest wykrywany automatycznie. GeoJSON: `FeatureCollection` obiektów `Point`, współrzędne w kolejności `[długość, szerokość]`, właściwości o tych samych nazwach. Współrzędne wyglądające na zamienione (dla Polski) są wykazywane jako błąd, z opcją świadomej zamiany. Duplikaty (ten sam `id_zrodlowe` albo ta sama nazwa w promieniu 10 m) są pomijane.

## Kopia JSON

„Zapisz kopię danych” zapisuje wszystkie punkty, wizyty, korekty, anulowania i rejony. Plik może zawierać prywatne lokalizacje i notatki.

Import: walidacja całego pliku przed zapisem, podgląd liczb, jedna transakcja. Nic nie jest kasowane ani nadpisywane. Właściciel z pliku jest ignorowany; dane trafiają na bieżące konto. Rekord o tym samym id: identyczny jest pomijany, a inny zostaje w obecnej wersji, zaś wersja z pliku trafia do Konfliktów. Raport CSV nie zastępuje tej kopii.

## Offline

Działa po wcześniejszym uruchomieniu: interfejs, zapisane punkty, wizyty, raporty, kopia. Nie działa: podkład mapy poza tym, co przeglądarka sama zachowała, wyszukiwanie Overpass, pierwsze logowanie. Service worker zapisuje wyłącznie pliki interfejsu. Warunki OpenStreetMap zakazują pobierania kafelków na zapas.

Aktualizacja aplikacji pyta o zgodę i nie dotyka IndexedDB.

## Ważne ograniczenia

- **iPhone:** Safari może usuwać dane stron nieużywanych przez 7 dni. Korzystaj z aplikacji dodanej do ekranu początkowego. Safari i aplikacja na ekranie mają osobne dane, więc po dodaniu zaloguj się w aplikacji.
- **Supabase Free** (stan z 2026-11-06, [cennik](https://supabase.com/pricing)): 500 MB bazy, 5 GB transferu, 2 aktywne projekty, brak automatycznych kopii. Projekt jest wstrzymywany po tygodniu bez aktywności, z mailem z wyprzedzeniem. Dane zostają, ale do czasu wznowienia w panelu synchronizacja nie działa; praca na telefonie trwa. Szczegóły: [docs/WDROZENIE.md](docs/WDROZENIE.md).
- **Overpass:** publiczne, przeciążone serwery bez gwarancji dostępności. Jedno kliknięcie to najwyżej po jednej próbie na każdy z 3 serwerów, bez automatycznych powtórzeń. Dokumentacja Overpass odradza opieranie masowych aplikacji na publicznych serwerach; tu działa to jako narzędzie jednego użytkownika z rzadkimi zapytaniami.
- **Podkład OSM:** bez SLA, dostęp może zostać ograniczony. Adres można zmienić zmienną `VITE_TILE_URL`.
- **Google Maps:** adres uruchamia nawigację, ale nie zwraca potwierdzenia przyjazdu.
