# CLAUDE.md — SaaS Publishing Worker

Contesto permanente del progetto. Leggilo prima di proporre modifiche.

## Cos'e' questo repo

Worker Node/TypeScript separato dal SaaS Next.js. Resta sempre acceso,
controlla la tabella `publishing_jobs` su Supabase e pubblica contenuti
social guidando un browser con Playwright.

Repo collegato: il SaaS Next.js 16 (App Router, React 19, Supabase,
shadcn/Radix). Condividono lo **stesso progetto Supabase**. Il worker usa
la service role key e bypassa RLS.

## Stato attuale: fase di esercitazione

Non stiamo pubblicando su Instagram vero. Il target e' un **sito copia
esterno** usato come palestra, indicato da `APP_URL`. Serve a testare
coda, sessioni, retry e stati senza rischiare account reali.

Conseguenze pratiche:
- non usiamo OAuth/token per questa piattaforma, ma login con sessione browser
- IP condiviso, fingerprint, rate limiting: **non sono preoccupazioni attuali**, non proporre soluzioni per questi problemi
- i selettori Playwright vanno adattati al sito copia, non a Instagram

## Decisioni di architettura gia' prese

Non rimetterle in discussione senza che te lo chieda esplicitamente.

1. **Un solo worker, N sessioni.** Non un worker per cliente. Il processo
   e' uno; l'identita' cambia caricando la sessione dell'account giusto.

2. **`storageState` cifrato su Supabase = unica fonte di verita'.**
   Niente `launchPersistentContext`, niente cartelle profilo su disco:
   non sono ricostruibili da un backup. La macchina che ospita il worker
   deve restare sostituibile.

3. **Il login e' manuale e una-tantum**, via script con browser visibile
   (`src/dev/loginAccount.ts`). Cosi' il 2FA non e' un problema. Il worker
   non fa mai login da solo: se la sessione e' scaduta, fallisce con
   `SESSION_EXPIRED` e l'account va riconnesso a mano.

4. **Nessuna password nel database.** Solo sessioni. `TOKEN_ENCRYPTION_KEY`
   serve a cifrare gli storageState (`src/lib/crypto.ts`, AES-256-GCM,
   modulo del worker, NON deve essere compatibile con `lib/crypto.ts`
   del SaaS).

5. **Claim atomico lato Postgres**, non in TypeScript. La funzione
   `claim_next_publishing_job()` usa `FOR UPDATE SKIP LOCKED` e garantisce
   un solo job per account alla volta.

6. **Ricette = piattaforma + formato.** Il campo `recipe_name` esiste gia'
   nello schema. Ogni ricetta e' un flusso a se': `photo`, `carousel`,
   `reel`, `story`. Non sono varianti di un post — story e reel hanno
   campi e passaggi diversi.

7. **`PublishPayload` come unione discriminata**, non un tipo unico con
   tutti i campi opzionali. Una story non deve poter avere `caption`.

8. **`live` non e' automatizzabile.** Va bloccato nella UI del SaaS.

## Regole non negoziabili

- **Mai riusare un browser context tra account diversi.** Un context nuovo
  per ogni job, `context.close()` in un `finally`. Riciclarlo significa
  pubblicare il contenuto di un cliente sul profilo di un altro, in
  silenzio. E' il bug peggiore possibile in questo prodotto.
- **Mai loggare credenziali, sessioni o storageState**, nemmeno in debug.
  Niente `console.log` di oggetti account interi.
- **Mai esporre `worker_sessions` al frontend.** Solo service role.
- `ENABLE_REAL_PUBLISHING=false` deve sempre impedire il click finale su
  "Condividi". E' l'interruttore di sicurezza, non toccarlo.
- Dopo il login, **verificare che l'utente loggato sia quello atteso**
  prima di pubblicare. Se non coincide, fermarsi.

## Convenzioni di codice

- TypeScript strict, ESM. **Gli import interni finiscono in `.js`**
  (`./config.js`), anche se il file sorgente e' `.ts`.
- Commenti in italiano, discorsivi, spiegano il *perche'* non il *cosa*.
  Mantieni questo stile: il repo e' scritto cosi'.
- Errori tipizzati con `PublisherError` + un `PublisherErrorCode`.
  Aggiungi codici nuovi all'union invece di usare stringhe libere.
- Niente dipendenze nuove senza chiedere.
- Dopo ogni modifica sostanziale: `npm run typecheck`.

## Problemi noti ancora aperti

In ordine di priorita'. Non risolverli tutti insieme.

1. `queue.ts` usa ancora select+update invece della RPC `claim_next_publishing_job`
2. `loadPublishingPayload` scarica i media con `fetch(file_url)`: fallisce
   con bucket privati, va usato `supabase.storage.download(storage_path)`
3. `playwrightPublisher` usa `APP_USERNAME`/`APP_PASSWORD` globali dal
   `.env`: va sostituito con la sessione per account
4. `job.platform` viene validato ma poi ignorato: pubblica sempre sullo
   stesso flusso, serve il dispatch per ricetta
5. Dopo un dry run il job resta in `processing` per sempre
6. `contents.status` non viene mai aggiornato dopo la pubblicazione:
   la dashboard mostra ancora "scheduled"
7. `external_post_id` non viene mai estratto
8. `tempDir` dedotto con `path.dirname(mediaPaths[0])` e poi cancellato
   ricorsivamente: pericoloso, va restituito esplicitamente dal loader
9. Locator hardcoded in italiano senza `locale: "it-IT"` sul context
10. `src/pubblica-post-media.spec.ts` sta dentro `src/` e finisce nel build