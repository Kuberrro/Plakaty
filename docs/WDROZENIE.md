# Wdrożenie krok po kroku

Wszystko poniżej jest bezpłatne. Nie podawaj karty, a jeśli jakaś strona jej wymaga, zatrzymaj się i daj znać. Układ paneli mógł się zmienić; jeśli nazwa przycisku jest inna, szukaj najbliższego odpowiednika.

## 1. Utwórz projekt Supabase

1. Wejdź na https://supabase.com i kliknij **Start your project**. Załóż konto.
2. Kliknij **New project**.
3. Wpisz nazwę `plakaty`, wygeneruj hasło bazy i zapisz je w menedżerze haseł. Region wybierz w Europie, np. Frankfurt.
4. Zostaw plan **Free** i kliknij **Create new project**. Poczekaj, aż projekt się uruchomi.

## 2. Uruchom SQL

1. W menu po lewej wybierz **SQL Editor**, potem **New query**.
2. Otwórz plik `supabase/migrations/0001_schema.sql`, zaznacz całość, skopiuj i wklej do edytora.
3. Kliknij **Run**. Powinno pojawić się „Success”.
4. Sprawdź w **Table Editor**, czy są tabele `points` i `visits`, obie z włączonym RLS.

## 3. Skonfiguruj logowanie i utwórz swoje konto

1. Wybierz **Authentication**, potem **Users**, potem **Add user** → **Create new user**.
2. Wpisz swój e-mail i silne hasło. Zaznacz **Auto Confirm User**, jeśli opcja jest dostępna.
3. Przejdź do ustawień logowania i wyłącz rejestrację nowych użytkowników. Nazwa przełącznika to prawdopodobnie **Allow new users to sign up** (w **Authentication → Sign In / Providers**). Tej nazwy nie udało się potwierdzić w dokumentacji, więc sprawdź, co pokazuje panel. Aplikacja nie ma ekranu rejestracji, a RLS i tak chroni dane, ale to dodatkowe zabezpieczenie.

## 4. Skopiuj publiczne parametry

1. Kliknij **Connect** na górze panelu albo wejdź w **Project Settings → API Keys**.
2. Skopiuj **Project URL** (`https://....supabase.co`) i **Publishable key** (`sb_publishable_...`). Jeśli klucza nie ma, utwórz go przyciskiem w tej sekcji.
3. **Nie kopiuj klucza secret** (`sb_secret_...`) ani `service_role`.

## 5. Utwórz repozytorium GitHub i wyślij kod

Najprościej przez aplikację GitHub Desktop.

1. Załóż konto na https://github.com i zainstaluj https://desktop.github.com.
2. W GitHub Desktop wybierz **File → Add Local Repository** i wskaż folder `Progress_Tracking_Map`.
3. Wpisz opis, np. „Pierwsza wersja”, i kliknij **Commit to main**.
4. Kliknij **Publish repository**. Nazwa: `plakaty`. **Odznacz „Keep this code private”**, bo GitHub Pages w darmowym planie działa dla repozytoriów publicznych. W repozytorium nie ma Twoich danych ani sekretów.

## 6. Ustaw parametry i GitHub Pages

1. W repozytorium na github.com otwórz **Settings → Secrets and variables → Actions**, zakładkę **Variables**, i kliknij **New repository variable**.
2. Dodaj dwie zmienne (zakładka Variables, nie Secrets, bo to parametry publiczne):
   - `VITE_SUPABASE_URL`: Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Publishable key
3. Otwórz **Settings → Pages** i w **Source** wybierz **GitHub Actions**.

## 7. Opublikuj

1. Otwórz zakładkę **Actions**, wybierz **Publikacja na GitHub Pages**, kliknij **Run workflow**.
2. Poczekaj na zielony znacznik (kilka minut). Czerwony krzyżyk: kliknij go i przekaż mi treść błędu.
3. Adres aplikacji: `https://TWOJ-LOGIN.github.io/plakaty/`

Każda kolejna wysyłka kodu publikuje aplikację automatycznie.

## 8. Otwórz na iPhonie i dodaj do ekranu początkowego

1. Otwórz adres w **Safari**.
2. Stuknij **Udostępnij** (kwadrat ze strzałką).
3. Wybierz **Do ekranu początkowego**, potem **Dodaj**.
4. **Od teraz otwieraj aplikację tylko z tej ikony.** Ma ona osobne dane niż Safari i jest chroniona przed automatycznym usuwaniem danych po 7 dniach.

## 9. Pierwsze logowanie i wyszukanie remiz

1. Zaloguj się w aplikacji e-mailem i hasłem z kroku 3.
2. Sprawdź, czy pasek u góry pokazuje „Zapisano w chmurze”.
3. Otwórz **Znajdź**, stuknij **Wyszukaj remizy**. Gdy pojawi się komunikat o przeciążeniu, odczekaj kilka minut i spróbuj ponownie.
4. Dodaj wybrane wyniki albo wszystkie nowe.

## 10. Wykonaj i przywróć kopię

1. **Ustawienia → Zapisz kopię danych**, zapisz w „Plikach” na iPhonie, najlepiej w iCloud Drive.
2. Rób kopię co tydzień. Supabase Free nie ma automatycznych kopii, więc to Twoje zabezpieczenie.
3. Przywracanie: **Ustawienia → Przywróć z kopii**, wybierz plik, sprawdź podgląd, **Zatwierdź import**. Nic nie zostanie usunięte. Dane trafią na konto, na które jesteś zalogowany.
4. Nie wrzucaj kopii do repozytorium ani nie wysyłaj jej publicznie.

## 11. Sprawdź bezpieczeństwo na prawdziwym projekcie

Automatyczne testy RLS przeszły na lokalnym Postgresie z emulacją Supabase. Ten krok potwierdza to na Twoim projekcie.

1. Utwórz drugie konto testowe jak w kroku 3 (np. inny Twój adres). Na czas testu to wystarczy; potem możesz je usunąć.
2. W terminalu, w folderze projektu, uruchom poniższe, wstawiając swoje wartości:

```bash
SUPABASE_URL=https://TWOJ-PROJEKT.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_TWOJ TEST_A_EMAIL=a@przyklad.pl TEST_A_PASSWORD=hasloA TEST_B_EMAIL=b@przyklad.pl TEST_B_PASSWORD=hasloB npm run test:rls:live
```

Oczekiwany wynik: „Wszystkie kontrole zaliczone”. Test tworzy jeden punkt „Test RLS” i usuwa go na końcu.

## Darmowy plan Supabase: co warto wiedzieć

Stan sprawdzony 2026-11-06 ([cennik](https://supabase.com/pricing), [wstrzymywanie](https://supabase.com/kb/faqs/platform/free-project-pausing)):

- Limity: 500 MB bazy, 5 GB transferu miesięcznie, 2 aktywne projekty. Tysiące punktów i wizyt zajmują ułamek tego limitu.
- **Brak automatycznych kopii.** Dlatego kopia JSON jest obowiązkowa.
- **Wstrzymanie:** przy zbyt małej aktywności w ciągu tygodnia projekt zostaje wstrzymany. Około tydzień wcześniej i po fakcie przychodzi e-mail. Zwykłe używanie aplikacji liczy się jako aktywność, ale Supabase nie gwarantuje progu.
- **Co to dla Ciebie znaczy:** po przerwie w używaniu synchronizacja pokaże błąd, a logowanie na nowym urządzeniu nie zadziała. Dane w projekcie zostają, a telefon pracuje dalej lokalnie i trzyma kolejkę.
- **Co zrobić:** zaloguj się do Supabase, otwórz projekt i kliknij przycisk przywrócenia, potem w aplikacji **Synchronizuj**.
- **Czego nie zweryfikowałem:** dokładnego czasu, przez jaki wstrzymany projekt można przywrócić. Strona pomocy nie podała tego w treści, którą udało się odczytać. Dlatego nie zostawiaj projektu wstrzymanego na miesiące i trzymaj kopię JSON.
- Warunki mogą się zmienić. Darmowy plan nie jest obietnicą dostępności.
