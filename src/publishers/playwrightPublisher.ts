import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
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
  const button = page.getByRole("button", { name: "Avanti" }).last();

  if (await isVisible(button)) {
    await button.click();
    return;
  }

  await page.getByText("Avanti", { exact: true }).last().click();
}

/**
 * Verifica se la sessione e' gia' autenticata; se non lo e', esegue il login
 * con APP_USERNAME/APP_PASSWORD. Se mancano le credenziali e la sessione
 * non e' valida, lancia un errore chiaro.
 */
async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });

  await clickIfVisible(page.getByRole("button", { name: "Rifiuta cookie facoltativi" }));

  const usernameField = page.getByRole("textbox", { name: "Numero di cellulare, nome" });

  if (await isVisible(usernameField)) {
    if (!config.appUsername || !config.appPassword) {
      throw new PublisherError(
        "AUTHENTICATION_FAILED",
        "La pagina richiede il login ma APP_USERNAME/APP_PASSWORD non sono configurati."
      );
    }

    await usernameField.fill(config.appUsername);
    await page.getByRole("textbox", { name: "Password" }).fill(config.appPassword);
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
  }

  // Chiude fino a due popup iniziali ("Salva le info" / notifiche), solo se visibili.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const notNow = page.getByRole("button", { name: "Non ora" }).first();
    if (!(await clickIfVisible(notNow))) break;
  }
}

async function saveStorageStateIfConfigured(context: BrowserContext): Promise<void> {
  if (!config.playwrightStorageStatePath) return;
  await context.storageState({ path: config.playwrightStorageStatePath });
}

async function openCreatePost(page: Page): Promise<void> {
  try {
    await page.getByRole("link", { name: "Nuovo post Crea" }).click();
    await clickIfVisible(page.getByRole("link", { name: "Post Post" }));

    await page.getByRole("dialog", { name: "Crea nuovo post" }).waitFor({ state: "visible" });
  } catch (err) {
    throw new PublisherError("UPLOAD_FAILED", "Impossibile aprire il dialog di creazione post.");
  }
}

async function uploadMedia(page: Page, options: PostOptions): Promise<void> {
  const createDialog = page.getByRole("dialog", { name: "Crea nuovo post" });

  await clickIfVisible(createDialog.getByRole("button", { name: "Seleziona dal computer" }));

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

  await clickAvanti(page);
}

async function configureVideoCover(page: Page, options: PostOptions): Promise<void> {
  if (options.kind !== "video" || !options.coverPath) return;

  const coverFile = assertFileExists(options.coverPath);
  const editDialog = page.getByRole("dialog", { name: "Modifica" });

  try {
    await editDialog.waitFor({ state: "visible" });
    await editDialog.getByRole("button", { name: "Seleziona dal computer" }).click();
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
    await page.getByRole("button", { name: "Condividi" }).click();

    // Segnale affidabile di pubblicazione completata: il dialog di creazione
    // post scompare (Instagram chiude il modale dopo la pubblicazione).
    await page
      .getByRole("dialog", { name: "Crea nuovo post" })
      .waitFor({ state: "hidden", timeout: 30_000 });
  } catch (err) {
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
  onStep?: (step: string) => Promise<void>
): Promise<PublishResult> {
  const browser = await chromium.launch({
    headless: config.playwrightHeadless,
    slowMo: config.playwrightSlowMo || undefined,
  });

  try {
    const storageState =
      config.playwrightStorageStatePath && fs.existsSync(config.playwrightStorageStatePath)
        ? config.playwrightStorageStatePath
        : undefined;

    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
      await onStep?.("authenticating");
      await ensureAuthenticated(page);
      await saveStorageStateIfConfigured(context);

      await onStep?.("opening-composer");
      await openCreatePost(page);

      await onStep?.("uploading-media");
      await uploadMedia(page, options);
      await configureVideoCover(page, options);

      await onStep?.("filling-details");
      await fillPostDetails(page, options);
      await configureAdvancedOptions(page, options);

      await onStep?.("confirming");
      return await confirmPublication(page, jobId, options);
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
