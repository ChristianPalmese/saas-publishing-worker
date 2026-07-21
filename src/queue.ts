import { supabase } from "./supabase.js";
import { config } from "./config.js";
import type { PublishingJobStatus } from "./types/publishing.js";

// Tipo che descrive un job cosi' come ci arriva dal database.
// Aggiungiamo i campi necessari per l'RPC di claim e la logica di retry.
export interface PublishingJob {
  id: string;
  content_id: string | null;
  platform: string | null;
  social_account_id: string | null;
  status: string;
  scheduled_at: string | null;
  recipe_name: string | null;
  options: Record<string, unknown>;
  current_step: string | null;
  retry_count: number | null;
  format: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number | null;
  max_attempts: number | null;
}

/**
 * Cerca UN job pronto da pubblicare e lo "prende in carico".
 *
 * "Pronto" = status 'pending' E orario di pubblicazione gia' passato.
 *
 * Il trucco importante e' il "claim atomico": aggiorniamo la riga da
 * 'pending' a 'processing' filtrando ANCHE per status = 'pending'.
 * Cosi' se per caso due worker girassero insieme, solo uno riesce a
 * cambiare la riga; l'altro trova che non e' piu' 'pending' e la salta.
 * E' il modo piu' semplice per evitare che lo stesso post venga
 * pubblicato due volte.
 *
 * (Gli stati validi sono definiti dal vincolo del DB:
 *  pending | processing | published | failed | cancelled)
 *
 * Ritorna il job preso in carico, oppure null se non c'e' lavoro.
 */
export async function claimNextJob(): Promise<PublishingJob | null> {
  const { data, error } = await supabase.rpc("claim_next_publishing_job", {
    p_worker_id: config.workerId,
  });

  if (error) {
    console.error("[queue] Errore nel claim RPC:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  const job = Array.isArray(data) ? data[0] : data;
  if (!job || job.id == null) {
    return null;
  }

  console.log(`[queue] Job preso in carico: ${job.id} (${job.platform ?? "?"})`);
  return job as PublishingJob;
}

/**
 * Aggiorna lo stato di un job. Lo useremo nelle fasi successive per
 * segnare 'published', 'error', 'blocked_verification', ecc.
 */
export async function updateJobStatus(
  jobId: string,
  status: PublishingJobStatus,
  extra: Partial<{
    current_step: string;
    error_code: string;
    external_post_id: string;
    published_at: string;
  }> = {}
): Promise<void> {
  if (!jobId || jobId === "null") {
    console.warn(`[queue] updateJobStatus ignorato per jobId non valido: ${JSON.stringify(jobId)}`);
    return;
  }

  const { error } = await supabase
    .from("publishing_jobs")
    .update({ status, ...extra })
    .eq("id", jobId);

  if (error) {
    console.error(`[queue] Errore aggiornando job ${jobId}:`, error.message);
  }
}