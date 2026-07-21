import { chromium, type Locator, type Page } from "playwright";
import { config } from "../config.js";
import { loadSession } from "../services/sessionStore.js";

async function getAccessibleName(locator: Locator): Promise<string | null> {
  const ariaLabel = await locator.getAttribute("aria-label");
  const title = await locator.getAttribute("title");
  const text = await locator.textContent();

  const name = [ariaLabel, text?.trim(), title]
    .map((value) => (value ? value.trim() : ""))
    .find((value) => value.length > 0);

  return name ?? null;
}

async function getTagName(locator: Locator): Promise<string> {
  return (await locator.evaluate((element) => element.tagName.toLowerCase())) as string;
}

async function inspectRole(
  role: "link" | "button" | "textbox" | "generic",
  container: Page | Locator,
  dialogName?: string
): Promise<void> {
  const context = dialogName
    ? container.getByRole("dialog", { name: dialogName })
    : container;
  const elements = await context.getByRole(role).all();

  for (const element of elements) {
    const name = await getAccessibleName(element);
    if (!name) continue;
    const tag = await getTagName(element);
    console.log(`[${role}/${tag}] "${name}"`);
  }
}

async function main(): Promise<void> {
  const socialAccountId = process.argv[2];
  const dialogName = process.argv[3];

  if (!socialAccountId) {
    console.error("Uso: npx tsx src/dev/inspectSelectors.ts <social-account-id> [dialog-name]");
    process.exitCode = 1;
    process.exit(1);
  }

  const state = await loadSession(socialAccountId);
  if (!state) {
    console.error(`Sessione non trovata o scaduta per account ${socialAccountId}.`);
    process.exitCode = 1;
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: state, locale: "it-IT" });
  const page = await context.newPage();

  try {
    await page.goto(config.appUrl, { waitUntil: "domcontentloaded" });

    for (const role of ["link", "button", "textbox", "generic"] as const) {
      await inspectRole(role, page, dialogName);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Errore durante l'ispezione dei selettori:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
