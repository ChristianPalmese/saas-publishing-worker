import path from "node:path";
import { supabase } from "../supabase.js";
import { config } from "../config.js";
import { loadPublishingPayload } from "../services/loadPublishingPayload.js";
import { publishMediaPost } from "../publishers/playwrightPublisher.js";
import { PublisherError } from "../types/publishing.js";
import type { PublishingJob } from "../queue.js";

/**
 * Dry run manuale di loadPublishingPayload() + publishMediaPost() su un
 * publishing_job GIA' ESISTENTE, senza passare da claimNextJob() e senza
 * scrivere alcuno stato sul job (nessun update su publishing_jobs).
 *
 * Rispetta ENABLE_REAL_PUBLISHING: se e' true il test si interrompe subito,
 * non viene mai premuto "Condividi".
 *
 * Uso: npx tsx src/dev/testJobDryRun.ts <publishing-job-id>
 */
async function main() {
  const jobId = process.argv[2];

  if (!jobId) {
    console.error("[dry-run] Uso: npx tsx src/dev/testJobDryRun.ts <publishing-job-id>");
    process.exit(1);
  }

  if (config.enableRealPublishing) {
    console.error("[dry-run] ENABLE_REAL_PUBLISHING=true: interrompo per sicurezza, questo script e' solo per dry run.");
    process.exit(1);
  }

  const { data: job, error } = await supabase
    .from("publishing_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    console.error(`[dry-run] Publishing job non trovato: ${jobId}`);
    process.exitCode = 1;
    return;
  }

  const typedJob = job as PublishingJob;

  try {
    const options = await loadPublishingPayload(typedJob);

    console.log("[dry-run] Job ID:", typedJob.id);
    console.log("[dry-run] Content ID:", typedJob.content_id);
    console.log("[dry-run] Piattaforma:", typedJob.platform);
    console.log("[dry-run] PostOptions.kind:", options.kind);
    console.log("[dry-run] Titolo/caption:", options.caption ?? "(nessuno)");
    console.log("[dry-run] Media scaricati:", options.mediaPaths.length);
    console.log("[dry-run] Copertina presente:", Boolean(options.coverPath));
    console.log(
      "[dry-run] Cartella temporanea media (NON eliminata, per verifica manuale):",
      path.dirname(options.mediaPaths[0]!)
    );

    const result = await publishMediaPost(
      typedJob.id,
      options,
      typedJob.social_account_id ?? "",
      async (step) => {
        console.log(`[dry-run] step: ${step}`);
      }
    );

    console.log("[dry-run] Risultato:", result);
  } catch (err) {
    if (err instanceof PublisherError) {
      console.error(`[dry-run] PublisherError ${err.code}: ${err.message}`);
    } else {
      console.error("[dry-run] Errore:", err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  }
}

main();
