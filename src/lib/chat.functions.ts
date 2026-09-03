import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

import type { ChatReply } from "./chat-contract";

/** Teto da frase aceita — espelha o do servidor para barrar já no cliente. */
export const MAX_MENSAGEM_CHAT = 1000;

/** Uma troca anterior da conversa, guardada só na tela. */
export type HistoricoChat = { role: "user" | "assistant"; content: string };

/** Anexo da mensagem, em base64 — o mesmo formato da importação de faturas. */
export type MidiaChat = { nome: string; mime: string; base64: string };

/**
 * Teto de transporte, bem acima dos limites reais (`CHAT_IA_MAX_IMAGEM_MB` e
 * `CHAT_IA_MAX_AUDIO_MB`, conferidos no servidor).
 *
 * Existe só para uma requisição absurda não atravessar a rede antes de ser
 * recusada; quem dá a mensagem útil sobre tamanho é o servidor, que conhece o
 * limite configurado.
 */
const MAX_ANEXO_BASE64 = 34 * 1024 * 1024;

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

function requireMidia(value: unknown, campo: string): MidiaChat {
  const midia = value as Partial<MidiaChat> | null;
  if (
    !midia ||
    typeof midia.base64 !== "string" ||
    typeof midia.mime !== "string" ||
    typeof midia.nome !== "string" ||
    !midia.base64
  ) {
    throw new Error(`Arquivo inválido em ${campo}`);
  }
  if (midia.base64.length > MAX_ANEXO_BASE64) throw new Error("Arquivo grande demais");
  return { nome: midia.nome.slice(0, 200), mime: midia.mime.slice(0, 100), base64: midia.base64 };
}

/** Diz à tela se o chat está configurado neste ambiente. */
export const getChatConfig = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async (): Promise<{ enabled: boolean; provider: string; model: string | null }> => {
    const { getChatSettings } = await import("@/integrations/postgres/config.server");
    try {
      const settings = getChatSettings();
      return { enabled: true, provider: settings.provider, model: settings.model };
    } catch {
      return { enabled: false, provider: "groq", model: null };
    }
  });

/**
 * Interpreta a mensagem e devolve a resposta.
 *
 * Uma consulta já vem respondida — os números saem do banco na mesma chamada.
 * Um registro vem como rascunho: nada foi gravado, e gravar é outra requisição,
 * disparada pela confirmação da pessoa.
 *
 * Com `imagem` ou `audio`, o servidor faz uma requisição a mais antes desta: o
 * anexo vira texto (modelo de visão ou de fala) e é esse texto que segue para o
 * modelo de chat. O que foi extraído volta em `origem`, para a tela mostrar.
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: {
      profileId: string;
      mensagem: string;
      historico?: HistoricoChat[];
      imagem?: MidiaChat;
      audio?: MidiaChat;
    }) => {
      const mensagem = typeof input?.mensagem === "string" ? input.mensagem.trim() : "";
      // Com anexo, a frase é opcional: uma foto do cupom já é o pedido inteiro.
      if (!mensagem && !input?.imagem && !input?.audio) {
        throw new Error("Escreva o que você quer consultar ou lançar");
      }
      if (mensagem.length > MAX_MENSAGEM_CHAT) {
        throw new Error(`Mensagem muito longa (máximo ${MAX_MENSAGEM_CHAT} caracteres)`);
      }
      // Um anexo por vez: são dois caminhos de extração diferentes, e juntá-los
      // numa requisição só tornaria ambíguo qual deles é o pedido.
      if (input?.imagem && input?.audio) {
        throw new Error("Envie uma imagem ou um áudio por vez");
      }

      const historico = Array.isArray(input?.historico) ? input.historico : [];
      return {
        profileId: requireId(input?.profileId, "profileId"),
        mensagem,
        ...(input?.imagem ? { imagem: requireMidia(input.imagem, "imagem") } : {}),
        ...(input?.audio ? { audio: requireMidia(input.audio, "audio") } : {}),
        // A tela é dona do histórico; aqui ele só é saneado. O teto de itens
        // que de fato viaja ao modelo é o do servidor (CHAT_IA_HISTORICO).
        historico: historico
          .filter(
            (item): item is HistoricoChat =>
              !!item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string",
          )
          .slice(-20)
          .map((item) => ({ role: item.role, content: item.content.slice(0, MAX_MENSAGEM_CHAT) })),
      };
    },
  )
  .handler(async ({ data, context }): Promise<ChatReply> => {
    const { responderChat } = await import("@/integrations/ai/chat/chat.server");
    return responderChat(context.user.id, data);
  });
