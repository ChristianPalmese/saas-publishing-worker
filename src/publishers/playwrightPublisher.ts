import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { loadSession, saveSession, markSessionExpired } from "../services/sessionStore.js";
import { PublisherError, type PostOptions, type PublishResult } from "../types/publishing.js";

function absoluteFile(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

function assertFileExists(filePath: string): string {
  const resolved = absoluteFile(filePath);
  if (!fs.existsSync(resolved)) {
    throw new PublisherError("MEDIA_FILE_NOT_FOUND", `File non trovato: ${filePath}`);
  }
  return resolved;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

async function clickIfVisible(locator: Locator): Promise<boolean> {
  if (!(await isVisible(locator))) return false;
  await locator.click();
  return true;
}

async function clickAvanti(page: Page): Promise<void> {
  const candidati = page.locator('[role="button"]:visible').filter({ hasText: /^\s*Avanti\s*$/ });

  try {
    await candidati.last().waitFor({ state: "visible", timeout: 20000 });
  } catch {
    const tutti = page.locator('[role="button"]:visible');
    const nomi: string[] = [];

    for (let i = 0; i < await tutti.count(); i += 1) {
      const t = (await tutti.nth(i).innerText().catch(() => "")).trim();
      if (t) nomi.push(t);
    }

    throw new PublisherError(
      "UPLOAD_FAILED",
      `Pulsante Avanti non comparso entro 20s. Bottoni visibili: ${nomi.join(" | ")}`
    );
  }

  const totale = await candidati.count();

  for (let i = totale - 1; i >= 0; i -= 1) {
    try {
      await candidati.nth(i).click({ timeout: 3000 });
      console.log(`[publisher] Avanti cliccato (indice ${i} di ${totale})`);
      return;
    } catch {
      continue;
    }
  }

  throw new PublisherError("UPLOAD_FAILED", `Avanti trovato (${totale}) ma nessun click riuscito.`);
}

async function avanzaFinoAllaDidascalia(page: Page): Promise<void> {
  const didascalia = page.getByRole("textbox", { name: /didascalia/i });

  for (let i = 0; i < 3; i += 1) {
    if (await didascalia.isVisible().catch(() => false)) return;
    await clickAvanti(page);
    await page.waitForTimeout(500);
  }

  if (!(await didascalia.isVisible().catch(() => false))) {
    throw new PublisherError(
      "UPLOAD_FAILED",
      "Schermata didascalia non raggiunta dopo 3 click su Avanti."
    );
  }
}

/**
 * Verifica che la sessione caricata dal database sia ancora valida.
 * Se la pagina mostra il login, la sessione viene marcata come scaduta
 * e viene sollevato un errore SESSION_EXPIRED.
 */
async function checkLoginPage(page: Page, socialAccountId: string): Promise<void> {
  const usernameField = page.getByRole("textbox", { name: "Numero di cellulare, nome" });

  if (await isVisible(usernameField)) {
    await markSessionExpired(socialAccountId);
    throw new PublisherError(
      "SESSION_EXPIRED",
      "Sessione scaduta o non autenticata: ricollega l'account."
    );
  }
}

async function openCreatePost(page: Page): Promise<void> {
  try {
    await page.getByRole("link", { name: /Nuovo post/i }).click();
    await clickIfVisible(page.getByRole("link", { name: /^Post/i }));

    await page.getByRole("dialog", { name: "Crea nuovo post" }).waitFor({ state: "visible" });
  } catch (err) {
    throw new PublisherError("UPLOAD_FAILED", "Impossibile aprire il dialog di creazione post.");
  }
}

async function uploadMedia(page: Page, options: PostOptions): Promise<void> {
  const createDialog = page.getByRole("dialog", { name: "Crea nuovo post" });

  const files = options.mediaPaths.map(assertFileExists);

  try {
    if (options.kind === "photo") {
      await createDialog.locator('input[type="file"]').setInputFiles(files[0]!);
    } else if (options.kind === "carousel") {
      await createDialog.locator('input[type="file"]').setInputFiles(files);
    } else {
      await createDialog.locator('input[type="file"]').setInputFiles(files[0]!);
    }
  } catch (err) {
    throw new PublisherError("UPLOAD_FAILED", "Caricamento del media principale fallito.");
  }

  await avanzaFinoAllaDidascalia(page);
}

async function configureVideoCover(page: Page, options: PostOptions): Promise<void> {
  if (options.kind !== "video" || !options.coverPath) return;

  const coverFile = assertFileExists(options.coverPath);
  const editDialog = page.getByRole("dialog", { name: "Modifica" });

  try {
    await editDialog.waitFor({ state: "visible" });
    await editDialog.locator('input[type="file"]').setInputFiles(coverFile);
  } catch (err) {
    throw new PublisherError("UPLOAD_FAILED", "Caricamento della copertina video fallito.");
  }

  await clickAvanti(page);
}

async function fillPostDetails(page: Page, options: PostOptions): Promise<void> {
  if (options.caption) {
    await page.getByRole("textbox", { name: "Scrivi una didascalia..." }).fill(options.caption);
  }

  if (options.location) {
    const locationField = page.getByRole("textbox", { name: "Aggiungi luogo" });
    await locationField.fill(options.location);

    const locationResult = page
      .getByRole("button", { name: new RegExp(`^${escapeRegExp(options.location)}(?:\\s|$)`, "i") })
      .first();

    await locationResult.click();
  }

  if (options.collaborator) {
    const collaboratorField = page.getByRole("textbox", { name: "Aggiungi collaboratori" });
    await collaboratorField.fill(options.collaborator);

    await page
      .getByRole("button", { name: new RegExp(escapeRegExp(options.collaborator), "i") })
      .first()
      .click();

    await page.getByRole("button", { name: "Fine" }).click();
  }

  if (options.altText) {
    await page.getByRole("button", { name: /Accessibilità Freccia verso/i }).click();
    await page.getByRole("textbox", { name: "Scrivi il testo alternativo..." }).fill(options.altText);
  }
}

async function configureAdvancedOptions(page: Page, options: PostOptions): Promise<void> {
  if (options.disableComments === undefined) return;

  await page.getByRole("button", { name: /Impostazioni avanzate Freccia/i }).click();

  // TODO: verificare manualmente il locator dello switch "Disattiva commenti"
  // sulla pagina di esercitazione: il codegen originale non gli assegna un
  // ruolo/etichetta univoci, quindi qui ci affidiamo al testo visibile.
  if (options.disableComments) {
    await page.getByText("Disattiva commenti", { exact: true }).click();
  }
}

async function confirmPublication(
  page: Page,
  jobId: string,
  options: PostOptions
): Promise<PublishResult> {
  const artifactsDir = absoluteFile("artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  if (!config.enableRealPublishing) {
    const screenshotPath = path.join(artifactsDir, `${jobId}-dry-run.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log("[publisher] Dry run completato: nessun contenuto condiviso");
    return { success: true, dryRun: true };
  }

  try {
    const dialog = page.getByRole("dialog", { name: "Crea nuovo post" });
    const condividi = dialog.locator('[role="button"]:visible').filter({ hasText: /^\s*Condividi\s*$/ });

    await condividi.last().waitFor({ state: "visible", timeout: 15000 });
    const totale = await condividi.count();
    console.log(`[publisher] Trovati ${totale} pulsanti Condividi nel dialog`);

    let cliccato = false;
    for (let i = totale - 1; i >= 0; i -= 1) {
      try {
        await condividi.nth(i).click({ timeout: 3000 });
        console.log(`[publisher] Condividi cliccato (indice ${i} di ${totale})`);
        cliccato = true;
        break;
      } catch {
        continue;
      }
    }

    if (!cliccato) {
      throw new PublisherError("PUBLICATION_FAILED", `Condividi trovato (${totale}) ma nessun click riuscito.`);
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(artifactsDir, `${jobId}-dopo-condividi.png`), fullPage: true });

    // 1. Conferma che l'operazione sia partita (puo' essere veloce)
    const progresso = page.getByText(/Condivisione in corso/i);
    await progresso.waitFor({ state: "visible", timeout: 10000 }).catch(() => {
      console.log("[publisher] Progresso non intercettato (upload rapido)");
    });

    // 2. Attendi che il progresso finisca
    await progresso.waitFor({ state: "hidden", timeout: 180000 }).catch(() => {
      throw new PublisherError("PUBLICATION_FAILED", "Upload non completato entro 3 minuti.");
    });

    // 3. Conferma esplicita di successo
    const fine = page.locator('[role="button"]:visible').filter({ hasText: /^\s*Fine\s*$/ });
    try {
      await fine.last().waitFor({ state: "visible", timeout: 30000 });
      console.log("[publisher] Pubblicazione confermata: schermata 'Post condiviso'");
      await page.screenshot({ path: path.join(artifactsDir, `${jobId}-pubblicato.png`), fullPage: true });
      await fine.last().click({ timeout: 5000 }).catch(() => {});
    } catch {
      const conferma = page.getByText(/condivis/i).last();
      try {
        await conferma.waitFor({ state: "visible", timeout: 30000 });
        console.log("[publisher] Pubblicazione confermata dall'interfaccia");
      } catch {
        await page.screenshot({ path: path.join(artifactsDir, `${jobId}-esito-incerto.png`), fullPage: true });
        throw new PublisherError(
          "PUBLICATION_FAILED",
          "Nessuna conferma di pubblicazione: esito incerto, vedi screenshot."
        );
      }
    }

    // 4. Margine per completare le richieste di rete pendenti
    await page.waitForTimeout(2000);
  } catch (err) {
    if (err instanceof PublisherError) throw err;
    throw new PublisherError("PUBLICATION_FAILED", "Clic su Condividi non confermato dall'interfaccia.");
  }

  return { success: true, dryRun: false };
}

/**
 * Esegue l'intero flusso di pubblicazione per un job: login, apertura
 * composer, upload media, dettagli, e conferma finale (o dry run).
 */
export async function publishMediaPost(
  jobId: string,
  options: PostOptions,
  socialAccountId: string,
  onStep?: (step: string) => Promise<void>
): Promise<PublishResult> {
  const state = await loadSession(socialAccountId);
  if (!state) {
    throw new PublisherError(
      "SESSION_EXPIRED",
      `Sessione mancante o scaduta per account ${socialAccountId}.`
    );
  }

  const browser = await chromium.launch({
    headless: config.playwrightHeadless,
    slowMo: config.playwrightSlowMo || undefined,
  });

  try {
    const context = await browser.newContext({ storageState: state, locale: "it-IT" });
    const page = await context.newPage();

    try {
      await onStep?.("authenticating");
      await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });
      await clickIfVisible(page.getByRole("button", { name: "Rifiuta cookie facoltativi" }));
      await checkLoginPage(page, socialAccountId);

      await onStep?.("opening-composer");
      await openCreatePost(page);

      await onStep?.("uploading-media");
      await uploadMedia(page, options);
      await configureVideoCover(page, options);

      await onStep?.("filling-details");
      await fillPostDetails(page, options);
      await configureAdvancedOptions(page, options);

      await onStep?.("confirming");
      const result = await confirmPublication(page, jobId, options);
      await saveSession(socialAccountId, await context.storageState());
      return result;
    } catch (err) {
      const artifactsDir = absoluteFile("artifacts");
      fs.mkdirSync(artifactsDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactsDir, `${jobId}-error.png`) }).catch(() => {});
      throw err;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
