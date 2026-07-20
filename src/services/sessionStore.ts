import type { BrowserContextOptions } from "playwright";
import { supabase } from "../supabase.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { PublisherError } from "../types/publishing.js";

export type StorageState = Exclude<BrowserContextOptions["storageState"], undefined>;

/**
 * Custodia delle sessioni browser, una per account social.
 *
 * La sessione e' lo storageState di Playwright: cookie + localStorage.
 * E' quello che dice al sito "sono il cliente X". Sta cifrato su
 * Supabase, mai su disco: cosi' la macchina che fa girare il worker
 * resta sostituibile e le sessioni sopravvivono a un redeploy.
 */

export interface SocialAccount {
  id: string;
  client_id: string;
  platform: string;
  account_name: string | null;
}

/**
 * Carica l'anagrafica dell'account su cui il job deve pubblicare.
 */
export async function getSocialAccount(accountId: string): Promise<SocialAccount> {
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, client_id, platform, account_name")
    .eq("id", accountId)
    .single();

  if (error || !data) {
    throw new PublisherError(
      "AUTHENTICATION_FAILED",
      `Account social non trovato: ${accountId}`
    );
  }

  return data as SocialAccount;
}

/**
 * Recupera la sessione di un account.
 *
 * Ritorna undefined se non esiste o se e' segnata come scaduta: in quel
 * caso il chiamante decide se fermarsi o tentare un login.
 */
export async function loadSession(accountId: string): Promise<StorageState | undefined> {
  const { data, error } = await supabase
    .from("worker_sessions")
    .select("state_encrypted, status")
    .eq("social_account_id", accountId)
    .maybeSingle();

  if (error) {
    console.error(`[sessions] Errore leggendo la sessione di ${accountId}:`, error.message);
    return undefined;
  }

  if (!data || data.status !== "active") {
    return undefined;
  }

  try {
    return JSON.parse(decrypt(data.state_encrypted)) as StorageState;
  } catch (err) {
    // Chiave sbagliata o dato corrotto: meglio trattarla come assente
    // che far esplodere il job con un errore criptico.
    console.error(`[sessions] Sessione di ${accountId} illeggibile:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Salva (o sovrascrive) la sessione di un account.
 *
 * Va chiamata dopo ogni job riuscito: i siti ruotano i cookie di
 * sessione, e riscrivere lo stato tiene viva la sessione piu' a lungo.
 */
export async function saveSession(accountId: string, state: StorageState): Promise<void> {
  const { error } = await supabase.from("worker_sessions").upsert(
    {
      social_account_id: accountId,
      state_encrypted: encrypt(JSON.stringify(state)),
      status: "active",
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "social_account_id" }
  );

  if (error) {
    // Non blocchiamo il job per questo: la pubblicazione magari e' gia'
    // andata a buon fine. Si perde solo il refresh della sessione.
    console.error(`[sessions] Errore salvando la sessione di ${accountId}:`, error.message);
  }
}

/**
 * Segna una sessione come scaduta. Da chiamare quando il worker si
 * accorge di non essere piu' loggato: nella dashboard quell'account
 * andra' mostrato come "da riconnettere".
 */
export async function markSessionExpired(accountId: string): Promise<void> {
  const { error } = await supabase
    .from("worker_sessions")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("social_account_id", accountId);

  if (error) {
    console.error(`[sessions] Errore marcando scaduta la sessione di ${accountId}:`, error.message);
  }
}