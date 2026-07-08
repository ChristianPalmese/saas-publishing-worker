# SaaS Publishing Worker

Worker di automazione browser per la pubblicazione social (Instagram / TikTok / Facebook).
Gira separato dal SaaS Next.js: resta sempre acceso, controlla la tabella
`publishing_jobs` su Supabase e (nelle fasi successive) pubblica i contenuti
guidando un browser con Playwright.

## Cosa fa in questa versione (Fase 1 + 2)

Per ora fa **solo la coda**, non pubblica ancora niente:

- si accende e resta in ascolto
- ogni N secondi controlla se ci sono post programmati il cui orario e' arrivato
- ne "prende in carico" uno alla volta (in modo sicuro, senza doppioni)
- lo segna come gestito (test)

La parte che apre davvero il browser e pubblica arrivera' nelle fasi successive.

## Requisiti

- Node.js 20 o superiore
- Un progetto Supabase con la tabella `publishing_jobs` (colonne: `status`,
  `scheduled_at`, `recipe_name`, `options`, `current_step`, `error_code`,
  `external_post_id`, `retry_count`)

## Setup

1. Installa le dipendenze:

   ```bash
   npm install
   ```

2. Installa il browser che usera' Playwright (serve solo dalle fasi successive,
   ma conviene farlo subito):

   ```bash
   npx playwright install chromium
   ```

3. Copia il file di esempio delle variabili d'ambiente e compilalo:

   ```bash
   cp .env.example .env
   ```

   Poi apri `.env` e inserisci i valori veri (vedi commenti dentro al file).
   Le tre chiavi obbligatorie sono `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` e `TOKEN_ENCRYPTION_KEY`.

## Avvio

Modalita' sviluppo (si riavvia da solo quando modifichi il codice):

```bash
npm run dev
```

Vedrai dei puntini `.` che scorrono: e' il worker che controlla la coda e
non trova lavoro. E' normale.

## Come provarlo

Per vedere il worker "prendere" un job, crea una riga di test nella tabella
`publishing_jobs` su Supabase con:

- `status` = `scheduled`
- `scheduled_at` = un orario gia' passato (es. adesso o ieri)

Entro pochi secondi il worker dovrebbe stamparlo in console e cambiarne lo stato.

## Struttura

```
worker/
  src/
    config.ts     -> legge e valida le variabili d'ambiente
    supabase.ts   -> connessione al database
    queue.ts      -> prende i job e ne aggiorna lo stato (la "coda")
    index.ts      -> il loop principale sempre acceso
  .env.example    -> modello delle variabili d'ambiente
  package.json
```
