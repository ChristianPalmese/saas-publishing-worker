import readline from "node:readline/promises";
import { chromium } from "playwright";
import { config } from "../config.js";
import { getSocialAccount, saveSession, loadSession } from "../services/sessionStore.js";

/**
 * Collega un account: apre un browser VISIBILE, ti lascia fare il login
 * a mano (2FA compreso), poi salva la sessione cifrata su Supabase.
 *
 * Va lanciato una volta per account. Da qui in poi il worker riusa la
 * sessione e non fa piu' login.
 *
 * Uso: npx tsx src/dev/loginAccount.ts <social-account-id>
 */
async function main() {
  const accountId = process.argv[2];

  if (!accountId) {
    console.error("[login] Uso: npx tsx src/dev/loginAccount.ts <social-account-id>");
    process.exit(1);
  }

  // Verifica che l'account esista prima di aprire il browser: meglio
  // fallire subito che dopo aver fatto login a mano.
  const account = await getSocialAccount(accountId);
  console.log(`[login] Account: ${account.account_name ?? account.id} (${account.platform})`);

  const esistente = await loadSession(accountId);
  if (esistente) {
    console.log("[login] Attenzione: esiste gia' una sessione attiva, verra' sovrascritta.");
  }

  console.log(`[login] Apro ${config.appUrl} in una finestra visibile...`);

  // headless: false sempre, indipendentemente dal .env: il senso di
  // questo script e' che tu veda la finestra e ci interagisca.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: "it-IT" });
  const page = await context.newPage();

  try {
    await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });

    console.log("");
    console.log("  ┌────────────────────────────────────────────────┐");
    console.log("  │  Fai il login nella finestra che si e' aperta. │");
    console.log("  │  Completa anche l'eventuale 2FA.               │");
    console.log("  │  Quando sei DENTRO, torna qui e premi Invio.   │");
    console.log("  └────────────────────────────────────────────────┘");
    console.log("");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("Premi Invio quando hai finito... ");
    rl.close();

    const state = await context.storageState();

    if (state.cookies.length === 0) {
      console.error("[login] Nessun cookie trovato: il login non sembra riuscito. Non salvo nulla.");
      process.exitCode = 1;
      return;
    }

    await saveSession(accountId, state);

    console.log(`[login] Sessione salvata (${state.cookies.length} cookie, ${state.origins.length} origin).`);
    console.log(`[login] L'account ${accountId} e' ora collegato.`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[login] Errore:", err instanceof Error ? err.message : err);
  process.exit(1);
});