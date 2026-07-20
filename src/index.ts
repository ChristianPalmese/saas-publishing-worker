import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { claimNextJob, updateJobStatus, type PublishingJob } from "./queue.js";
import { publishMediaPost } from "./publishers/playwrightPublisher.js";
import { loadPublishingPayload } from "./services/loadPublishingPayload.js";
import { PublisherError } from "./types/publishing.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let running = true;

/**
 * Gestisce un singolo job: valida le opzioni, aggiorna current_step,
 * chiama il publisher Playwright e riporta l'esito su Supabase.
 */
async function processJob(job: PublishingJob): Promise<void> {
  console.log(`[worker] Lavoro il job ${job.id}...`);

  let tempDir: string | undefined;

  try {
    await updateJobStatus(job.id, "processing", { current_step: "loading-payload" });
    const options = await loadPublishingPayload(job);
    tempDir = options.mediaPaths[0] ? path.dirname(options.mediaPaths[0]) : undefined;

    await updateJobStatus(job.id, "processing", { current_step: "publishing" });

    if (!job.social_account_id) {
      throw new PublisherError("SESSION_EXPIRED", "Job privo di social_account_id, impossibile autenticare la sessione.");
    }

    const result = await publishMediaPost(
      job.id,
      options,
      job.social_account_id,
      async (step) => {
        await updateJobStatus(job.id, "processing", { current_step: step });
      }
    );

    if (result.dryRun) {
      await updateJobStatus(job.id, "processing", { current_step: "dry-run-completed" });
      console.log(`[worker] Job ${job.id}: dry run completato, nessuna pubblicazione reale.`);
      return;
    }

    await updateJobStatus(job.id, "published", {
      current_step: "publication-completed",
      ...(result.externalPostId ? { external_post_id: result.externalPostId } : {}),
    });
    console.log(`[worker] Job ${job.id} pubblicato.`);
  } catch (err) {
    const errorCode = err instanceof PublisherError ? err.code : "UNKNOWN_ERROR";
    console.error(`[worker] Job ${job.id} fallito (${errorCode}):`, err instanceof Error ? err.message : err);

    await updateJobStatus(job.id, "failed", {
      current_step: "publication-failed",
      error_code: errorCode,
    });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function mainLoop(): Promise<void> {
  console.log(`[worker] Avviato (id: ${config.workerId}).`);

  if (!config.enableRealPublishing) {
    console.log("[worker] Pubblicazione reale disabilitata. La coda non verrà elaborata.");
    console.log("[worker] Premi Ctrl+C per fermare.\n");

    while (running) {
      await sleep(config.pollIntervalMs);
    }

    console.log("\n[worker] Fermato in modo pulito. A presto!");
    return;
  }

  console.log(`[worker] Controllo la coda ogni ${config.pollIntervalMs / 1000} secondi.`);
  console.log(`[worker] Premi Ctrl+C per fermare.\n`);

  while (running) {
    try {
      const job = await claimNextJob();

      if (job) {
        await processJob(job);
      } else {
        process.stdout.write(".");
      }
    } catch (err) {
      console.error("\n[worker] Errore imprevisto nel loop:", err);
    }

    await sleep(config.pollIntervalMs);
  }

  console.log("\n[worker] Fermato in modo pulito. A presto!");
}

process.on("SIGINT", () => {
  console.log("\n[worker] Ricevuto segnale di stop, finisco il ciclo corrente...");
  running = false;
});

mainLoop();
