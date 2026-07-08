import { config } from "./config.js";
import { claimNextJob, updateJobStatus } from "./queue.js";

// Piccola utility per "aspettare" un tot di millisecondi.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Flag per uno spegnimento pulito quando premi Ctrl+C.
let running = true;

/**
 * Questa e' la funzione che gestisce UN job.
 *
 * IMPORTANTE (Fase 1+2): per ora NON apre nessun browser e NON pubblica niente.
 * Si limita a dimostrare che il job e' stato preso correttamente,
 * poi lo rimette in uno stato di test. La logica vera (Playwright,
 * ricette, pubblicazione) la aggiungiamo nelle fasi successive.
 */
async function processJob(jobId: string): Promise<void> {
  console.log(`[worker] Sto "lavorando" il job ${jobId}...`);
  console.log(`[worker] (In questa fase non pubblico ancora nulla: e' solo un test della coda.)`);

  // Simuliamo un attimo di lavoro
  await sleep(1000);

  // Per ora lo segniamo con uno stato di test cosi' vedi che il ciclo funziona.
  // Nelle fasi successive qui ci sara' il risultato reale (published / error / ecc.)
  await updateJobStatus(jobId, "queued", { current_step: "test-ok" });
  console.log(`[worker] Job ${jobId} gestito (test). Lo rimetto in 'queued'.`);
}

/**
 * Il loop principale: resta acceso e ogni POLL_INTERVAL_MS controlla la coda.
 * E' il "fattorino che guarda la lavagna ogni tot secondi".
 */
async function mainLoop(): Promise<void> {
  console.log(`[worker] Avviato (id: ${config.workerId}).`);
  console.log(`[worker] Controllo la coda ogni ${config.pollIntervalMs / 1000} secondi.`);
  console.log(`[worker] Premi Ctrl+C per fermare.\n`);

  while (running) {
    try {
      const job = await claimNextJob();

      if (job) {
        await processJob(job.id);
      } else {
        // Nessun lavoro: aspetto e riprovo.
        // (Stampa un puntino cosi' vedi che e' vivo, senza intasare la console.)
        process.stdout.write(".");
      }
    } catch (err) {
      console.error("\n[worker] Errore imprevisto nel loop:", err);
    }

    await sleep(config.pollIntervalMs);
  }

  console.log("\n[worker] Fermato in modo pulito. A presto!");
}

// Gestione dello spegnimento con Ctrl+C
process.on("SIGINT", () => {
  console.log("\n[worker] Ricevuto segnale di stop, finisco il ciclo corrente...");
  running = false;
});

mainLoop();
