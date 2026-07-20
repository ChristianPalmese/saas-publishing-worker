import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Cifratura simmetrica per le sessioni browser.
 *
 * Nota importante: questo modulo e' del worker e basta. Le sessioni le
 * scrive e le rilegge solo il worker, quindi NON deve essere compatibile
 * con lib/crypto.ts del SaaS. Se un domani il SaaS dovesse leggere questi
 * dati (non serve, e non dovrebbe), allora i due formati vanno allineati.
 *
 * Algoritmo: AES-256-GCM. Autenticato, quindi un dato manomesso non
 * viene decifrato a meta' ma fallisce e basta.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // standard per GCM
const PREFIX = "v1";

/**
 * Ricava la chiave a 32 byte da TOKEN_ENCRYPTION_KEY, accettando i tre
 * formati piu' comuni cosi' non devi cambiare la chiave che hai gia':
 *   - 64 caratteri esadecimali  -> usata cosi' com'e'
 *   - base64 che decodifica a 32 byte -> usata cosi' com'e'
 *   - qualsiasi altra stringa   -> derivata con scrypt
 */
function getKey(): Buffer {
  const raw = config.tokenEncryptionKey;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // non era base64, si passa alla derivazione
  }

  // Salt fisso: la chiave e' gia' segreta, qui serve solo normalizzare
  // la lunghezza in modo deterministico.
  return crypto.scryptSync(raw, "saas-publishing-worker", 32);
}

/** Cifra una stringa. Ritorna "v1:iv:tag:ciphertext" in base64. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/** Decifra una stringa prodotta da encrypt(). Lancia se il dato e' alterato. */
export function decrypt(payload: string): string {
  const parts = payload.split(":");

  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("[crypto] Formato del dato cifrato non riconosciuto.");
  }

  const [, ivB64, tagB64, dataB64] = parts;

  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64!, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64!, "base64")),
    decipher.final(),
  ]).toString("utf8");
}