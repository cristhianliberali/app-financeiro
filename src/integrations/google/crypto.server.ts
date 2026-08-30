/**
 * Cifra dos tokens do Google guardados no banco.
 *
 * Um refresh token dá acesso contínuo à agenda de alguém, então ele não pode
 * ficar legível numa coluna: um dump do banco viraria acesso à agenda de todo
 * mundo. AES-256-GCM com chave derivada do segredo do app — o mesmo padrão
 * autocontido das senhas (`password.server.ts`), com o formato guardando o que
 * é preciso para decifrar depois.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { getGoogleTokenSecret } from "../postgres/config.server";

const ALGORITHM = "aes-256-gcm";
const SALT = "aura.google.tokens";

let cachedKey: { secret: string; key: Buffer } | undefined;

function keyFor(secret: string): Buffer {
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = scryptSync(secret, SALT, 32);
  cachedKey = { secret, key };
  return key;
}

/** `iv:tag:conteúdo`, tudo em base64. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFor(getGoogleTokenSecret()), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptToken(stored: string): string {
  const [iv, tag, payload] = stored.split(":");
  if (!iv || !tag || !payload) throw new Error("Token do Google gravado em formato inválido.");

  const decipher = createDecipheriv(
    ALGORITHM,
    keyFor(getGoogleTokenSecret()),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
