/**
 * Hash de senha com scrypt (node:crypto).
 *
 * scrypt já vem no Node, então não há dependência nativa para compilar na
 * imagem. O formato guardado no banco é autocontido — `scrypt$N$r$p$salt$hash`
 * — para que os parâmetros possam mudar no futuro sem invalidar as senhas já
 * cadastradas.
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function maxmem(N: number, r: number): number {
  // O default do Node (32 MB) não cobre N=16384 com folga em todas as versões.
  return 256 * N * r * 2;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxmem(COST, BLOCK_SIZE),
  });
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number.parseInt(parts[1]!, 10);
  const r = Number.parseInt(parts[2]!, 10);
  const p = Number.parseInt(parts[3]!, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: maxmem(N, r),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Alfabeto da senha provisória, sem os caracteres que se confundem lidos de um
 * e-mail: `0`/`O`, `1`/`l`/`I`, `5`/`S`, `2`/`Z`. Quem recebe vai digitar isto à
 * mão, e uma senha ambígua vira um "não consigo entrar" que ninguém consegue
 * diagnosticar pelo suporte.
 */
const ALFABETO_LEGIVEL = "ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnopqrstuvwxyz346789";

/**
 * Senha provisória aleatória, em grupos separados por hífen (`Kf7x-Pq2m-Tb9w`).
 *
 * São 12 caracteres de um alfabeto de 52 — cerca de 68 bits de entropia, muito
 * acima do que uma senha digitada por pessoa costuma ter. Os grupos existem só
 * para a leitura: dividir em três blocos de quatro é o que torna possível
 * copiar do e-mail sem errar.
 *
 * `randomInt` do node:crypto é usado em vez de `Math.random` porque isto é
 * credencial: um gerador previsível aqui valeria por uma senha adivinhável.
 */
export function gerarSenhaProvisoria(): string {
  const grupos: string[] = [];
  for (let g = 0; g < 3; g += 1) {
    let bloco = "";
    for (let i = 0; i < 4; i += 1) {
      bloco += ALFABETO_LEGIVEL[randomInt(ALFABETO_LEGIVEL.length)];
    }
    grupos.push(bloco);
  }
  return grupos.join("-");
}
