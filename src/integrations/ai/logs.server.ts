/**
 * Log das requisições de IA.
 *
 * Cada chamada ao provedor deixa duas linhas no log do servidor: o que foi
 * enviado (prompt do sistema, texto do lote, modelo, tamanho) e o que voltou
 * (resposta crua, tokens cobrados, duração). É por isso que a importação de uma
 * fatura pode ser auditada depois — sem isso, quando o modelo erra uma linha
 * não há como saber se o problema foi o prompt, o documento ou a resposta.
 *
 * Sai em `console.info`/`console.error`, que é onde o painel (EasyPanel) mostra
 * o log do container. Nada é gravado em banco nem em arquivo: o conteúdo de uma
 * fatura não deve ficar guardado além do necessário.
 *
 * Controle por variável de ambiente:
 *   LOG_IA=false                      desliga tudo
 *   LOG_IA_CORPO=false                mantém só os números, sem prompt/resposta
 *   LOG_IA_LIMITE_CARACTERES=2000     tamanho de cada trecho registrado
 */
import { randomUUID } from "node:crypto";

import { getAiLogSettings } from "../postgres/config.server";

/** Contexto de quem pediu, repetido nas duas pontas para poder cruzar as linhas. */
export type AiLogContext = {
  requestId: string;
  userId: string;
  profileId: string;
  importId: string;
  /** Lote atual e total, quando o documento foi dividido. */
  batch: number;
  totalBatches: number;
};

export function newRequestId(): string {
  return randomUUID().slice(0, 8);
}

/** Corta o trecho no limite configurado, dizendo quanto ficou de fora. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (+${text.length - maxChars} caracteres omitidos)`;
}

function tag(context: AiLogContext): string {
  return (
    `[ia ${context.requestId}] usuário=${context.userId} perfil=${context.profileId} ` +
    `importação=${context.importId} lote=${context.batch}/${context.totalBatches}`
  );
}

export function logAiRequest(
  context: AiLogContext,
  request: {
    provider: string;
    model: string;
    systemPrompt: string;
    userText: string;
    categories: number;
  },
): void {
  const settings = getAiLogSettings();
  if (!settings.enabled) return;

  const header =
    `${tag(context)} → requisição: provedor=${request.provider} modelo=${request.model} ` +
    `categorias=${request.categories} caracteres=${request.userText.length}`;

  if (!settings.includeBody) {
    console.info(header);
    return;
  }

  console.info(
    [
      header,
      "--- system ---",
      clip(request.systemPrompt, settings.maxChars),
      "--- documento ---",
      clip(request.userText, settings.maxChars),
      "--- fim ---",
    ].join("\n"),
  );
}

export function logAiResponse(
  context: AiLogContext,
  response: {
    model: string;
    /** Milissegundos entre o envio e a resposta completa. */
    durationMs: number;
    rows: number;
    content: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  },
): void {
  const settings = getAiLogSettings();
  if (!settings.enabled) return;

  const usage = response.usage;
  const header =
    `${tag(context)} ← resposta: modelo=${response.model} ${response.durationMs}ms ` +
    `lançamentos=${response.rows} tokens=${usage?.prompt_tokens ?? "?"}+` +
    `${usage?.completion_tokens ?? "?"}=${usage?.total_tokens ?? "?"}`;

  if (!settings.includeBody) {
    console.info(header);
    return;
  }

  console.info(
    [header, "--- resposta ---", clip(response.content, settings.maxChars), "--- fim ---"].join(
      "\n",
    ),
  );
}

/** Falha na chamada. Sempre registrada, mesmo com `LOG_IA=false`. */
export function logAiError(context: AiLogContext, error: unknown, durationMs: number): void {
  console.error(
    `${tag(context)} ✕ falhou depois de ${durationMs}ms: ` +
      (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
  );
}
