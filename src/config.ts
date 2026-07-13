import dotenv from "dotenv";

dotenv.config();

// Piccola funzione di aiuto: legge una variabile d'ambiente e,
// se manca, ferma subito il programma con un messaggio chiaro.
// Meglio bloccarsi all'avvio che scoprire a meta' lavoro che manca una chiave.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Manca la variabile d'ambiente obbligatoria: ${name}`);
    console.error(`[config] Controlla il tuo file .env (vedi .env.example)`);
    process.exit(1);
  }
  return value;
}

// "true"/"1" => true, tutto il resto (compreso undefined) => false.
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),

  // Questi hanno un valore di default, quindi non sono obbligatori
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 10000),
  workerId: process.env.WORKER_ID ?? "worker-local-1",

  // Configurazione Playwright / pagina di esercitazione.
  appUrl: process.env.APP_URL ?? "https://www.instagram.com/",
  appUsername: process.env.APP_USERNAME || undefined,
  appPassword: process.env.APP_PASSWORD || undefined,
  playwrightStorageStatePath: process.env.PLAYWRIGHT_STORAGE_STATE_PATH || undefined,
  playwrightHeadless: parseBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
  playwrightSlowMo: Number(process.env.PLAYWRIGHT_SLOW_MO ?? 0),

  // Interruttore di sicurezza: finche' e' false, non si preme mai "Condividi".
  enableRealPublishing: parseBoolean(process.env.ENABLE_REAL_PUBLISHING, false),
};
