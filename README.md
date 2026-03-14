# DomowyKsiegowyPWA

PWA do szybkiego dodawania wydatkow domowych. Aplikacja pozwala:

- zrobic zdjecie paragonu lub wrzucic PDF,
- odczytac kwote lokalnym OCR w przegladarce przez `tesseract.js`,
- zapisac dokument w Paperless,
- utworzyc transakcje w Firefly III.

## Wymagania

- Node.js 20+ lub 22+
- npm 10+
- dostep do instancji Paperless-ngx
- dostep do instancji Firefly III z tokenem API

Nie trzeba instalowac systemowego Tesseract OCR. OCR dziala przez `tesseract.js` po stronie przegladarki.

## Instalacja

```bash
npm install
```

## Konfiguracja zmiennych srodowiskowych

Skopiuj plik przykladowy i uzupelnij wlasnymi wartosciami:

```bash
cp .env.example .env.local
```

Wymagane zmienne:

- `PAPERLESS_API_URL` - adres API Paperless, np. `http://192.168.50.66:8000/api`
- `PAPERLESS_API_TOKEN` - token API Paperless
- `FIREFLY_API_URL` - adres API Firefly, np. `http://192.168.50.66:8082/api/v1`
- `FIREFLY_API_TOKEN` - token API Firefly III

Pliki `.env`, `.env.local` i inne warianty `.env*` sa ignorowane przez Git. Nie commituj tam sekretow do repozytorium.

## Uruchomienie lokalne

```bash
npm run dev
```

Aplikacja bedzie dostepna pod adresem `http://localhost:3000`.

## Build produkcyjny

```bash
npm run build
npm run start
```

## Docker

W repo jest przygotowany `Dockerfile` do builda i uruchomienia aplikacji:

```bash
docker build -t domowy-ksiegowy-pwa .
docker run --rm -p 3000:3000 --env-file .env.local domowy-ksiegowy-pwa
```

## Uwagi wdrozeniowe

- `next.config.mjs` ustawia limit `serverActions.bodySizeLimit` na `20mb`.
- `allowedOrigins` w `next.config.mjs` zawiera obecnie `finanse.miasoftware.pl` i `192.168.50.66:3000`. Przy zmianie domeny lub portu trzeba to zaktualizowac.
- Manifest PWA oczekuje ikon `icon-192.png` i `icon-512.png`.

## Bezpieczenstwo

- Nie wypychaj prawdziwych tokenow API do GitHub.
- Przed pushem sprawdzaj, czy w stagingu nie ma `.env`, dumpow, backupow albo innych plikow z danymi.
- Jesli sekret byl kiedykolwiek publicznie ujawniony, trzeba go zrotowac po stronie Paperless lub Firefly.
