# Testy odbiorowe

Legenda: **AUTO** to test automatyczny (Chrome w rozmiarze iPhone'a, atrapa API); **RLS** to prawdziwy Postgres z emulacją Supabase; **iPhone** wymaga sprawdzenia przez Ciebie. Test automatyczny w Chrome nie zastępuje Safari, dlatego prawie wszystkie punkty są też na liście iPhone'a.

| # | Sprawdzenie | Auto | Na iPhonie |
|---|---|---|---|
| 1 | Wyszukanie remiz i dodanie do bazy | AUTO (Overpass podstawiony) | tak |
| 2 | Ponowne wyszukiwanie nie dubluje i nie zmienia historii | AUTO | tak |
| 3 | Ręczne dodanie i korekta lokalizacji | AUTO | tak |
| 4 | Nawigacja wskazuje właściwe współrzędne | AUTO (adres) | **tak** |
| 5 | „Nawiguj” nie zapisuje wizyty | AUTO | tak |
| 6 | Aktywny cel po ponownym otwarciu | AUTO (odświeżenie) | **tak** |
| 7 | Wizyta aktualizuje liczniki | AUTO | tak |
| 8 | Zamknięcie i otwarcie nie usuwa danych | AUTO (odświeżenie) | **tak** |
| 9 | Offline: zapis lokalny | AUTO | **tak** |
| 10 | Powrót internetu bez podwójnych wizyt | AUTO (atrapa API) | **tak** |
| 11 | Świeża przeglądarka pobiera dane z chmury | AUTO (atrapa API) | **tak** |
| 12 | Korekty i anulowania zmieniają raporty | AUTO | tak |
| 13 | Eksport i import JSON | AUTO | **tak** |
| 14 | Błędny import nie niszczy danych | AUTO | tak |
| 15 | Awaria Overpass nie blokuje wizyt | AUTO | nie |
| 16 | Brak zgody na GPS nie blokuje pracy | AUTO | **tak** |
| 17 | RLS: bez logowania i drugie konto | RLS | `npm run test:rls:live` |
| 18 | Działanie pod ścieżką GitHub Pages | AUTO (lokalnie ta sama ścieżka) | po publikacji |
| 19 | Aktualizacja nie kasuje kolejki | AUTO (symulacja) | **tak** |
| 20 | Przełączenie kont nie ujawnia danych | AUTO (atrapa API) | tak |

## Lista dla iPhone'a

Wykonaj po wdrożeniu, w aplikacji otwieranej z ikony. Zaznaczaj wynik; każdy problem zapisz z numerem.

**Instalacja**
- [ ] Ikona na ekranie, aplikacja otwiera się bez paska Safari.
- [ ] Nic nie chowa się pod wycięciem ekranu ani pod paskiem na dole.
- [ ] Mapa pokazuje podkład OSM i podpis „© OpenStreetMap”.
- [ ] Pasek u góry pokazuje stan internetu i synchronizacji.

**Nawigacja (najważniejsze, tego nie dało się sprawdzić automatycznie)**
- [ ] „Nawiguj” otwiera Google Maps. Jeśli nic się nie stało, stuknij pojawiający się przycisk „Otwórz Google Maps” i zanotuj, że to było potrzebne.
- [ ] Cel w Google Maps to właściwe miejsce, tryb samochód.
- [ ] Przy punkcie z tablicą nawigacja prowadzi do tablicy.
- [ ] Po powrocie widać kartę „Czy udało się rozwiesić plakat?”.
- [ ] Zamknij aplikację w przełączniku aplikacji, otwórz ją: karta nadal jest.
- [ ] „Plakat powieszony”, zapis wizyty, licznik rośnie.

**Offline**
- [ ] Włącz tryb samolotowy i otwórz aplikację z ikony: uruchamia się, punkty są.
- [ ] Zapisz wizytę: pasek pokazuje „Oczekuje na synchronizację”.
- [ ] Zamknij i otwórz aplikację: wizyta i kolejka są.
- [ ] Wyłącz tryb samolotowy i otwórz aplikację: „Zapisano w chmurze”, wizyta tylko raz (sprawdź w Supabase: Table Editor → visits).

**Lokalizacja**
- [ ] „Moja lokalizacja”: pierwsze pytanie o zgodę. Po odmowie aplikacja działa.
- [ ] Po zgodzie lista pokazuje odległości z dopiskiem „w linii prostej”.
- [ ] Pomiar GPS przy wizycie zapisuje się tylko po stuknięciu.

**Kopia i pliki**
- [ ] „Zapisz kopię danych” otwiera arkusz udostępniania lub pobieranie; plik trafia do „Plików”.
- [ ] Na drugim urządzeniu po zalogowaniu widać te same dane.
- [ ] Przywrócenie z kopii pokazuje podgląd i niczego nie dubluje.
- [ ] Raport CSV otwiera się z polskimi znakami.
- [ ] „Drukuj” pokazuje czytelny raport.

**Aktualizacja**
- [ ] Po publikacji nowej wersji pojawia się pasek „Dostępna nowa wersja” (może wymagać ponownego otwarcia aplikacji). „Odśwież” zachowuje dane i kolejkę.
