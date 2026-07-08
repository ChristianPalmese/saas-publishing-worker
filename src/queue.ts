import { supabase } from "./supabase.js";
import { config } from "./config.js";

// Tipo che descrive un job cosi' come ci arriva dal database.
// (Semplificato: aggiungeremo campi man mano che servono nelle fasi successive.)
export interface PublishingJob {
  id: string;
  content_id: string | null;
  platform: string | null;
  status: string;
  scheduled_at: string | null;
  recipe_name: string | null;
  options: Record<string, unknown>;
  current_step: string | null;
  retry_count: number | null;
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
  // 1. Cerco un candidato: il job in attesa piu' vecchio il cui orario e' arrivato.
  const nowIso = new Date().toISOString();

  const { data: candidates, error: selectError } = await supabase
    .from("publishing_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (selectError) {
    console.error("[queue] Errore nel cercare job:", selectError.message);
    return null;
  }

  if (!candidates || candidates.length === 0) {
    return null; // nessun lavoro al momento
  }

  const candidate = candidates[0] as PublishingJob;

  // 2. Provo a "reclamarlo": lo passo a 'processing' SOLO se e' ancora 'pending'.
  //    Se un altro worker l'ha gia' preso, questo update non tocca nessuna riga.
  const { data: claimed, error: claimError } = await supabase
    .from("publishing_jobs")
    .update({
      status: "processing",
      current_step: "claimed",
    })
    .eq("id", candidate.id)
    .eq("status", "pending") // <-- questa condizione e' il "lock"
    .select()
    .single();

  if (claimError) {
    // Se l'errore e' "nessuna riga aggiornata", vuol dire che un altro
    // worker l'ha preso un attimo prima: non e' un vero errore, riproviamo dopo.
    console.warn("[queue] Job gia' preso da un altro worker o non piu' disponibile:", candidate.id);
    return null;
  }

  console.log(`[queue] Job preso in carico: ${claimed.id} (${claimed.platform ?? "?"})`);
  return claimed as PublishingJob;
}

/**
 * Aggiorna lo stato di un job. Lo useremo nelle fasi successive per
 * segnare 'published', 'error', 'blocked_verification', ecc.
 */
export async function updateJobStatus(
  jobId: string,
  status: string,
  extra: Partial<{
    current_step: string;
    error_code: string;
    external_post_id: string;
  }> = {}
): Promise<void> {
  const { error } = await supabase
    .from("publishing_jobs")
    .update({ status, ...extra })
    .eq("id", jobId);

  if (error) {
    console.error(`[queue] Errore aggiornando job ${jobId}:`, error.message);
  }
}