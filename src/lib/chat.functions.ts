import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

import type { ChatReply } from "./chat-contract";

/** Teto da frase aceita — espelha o do servidor para barrar já no cliente. */
export const MAX_MENSAGEM_CHAT = 1000;

/** Uma troca anterior da conversa, guardada só na tela. */
export type HistoricoChat = { role: "user" | "assistant"; content: string };

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
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
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { profileId: string; mensagem: string; historico?: HistoricoChat[] }) => {
    const mensagem = typeof input?.mensagem === "string" ? input.mensagem.trim() : "";
    if (!mensagem) throw new Error("Escreva o que você quer consultar ou lançar");
    if (mensagem.length > MAX_MENSAGEM_CHAT) {
      throw new Error(`Mensagem muito longa (máximo ${MAX_MENSAGEM_CHAT} caracteres)`);
    }

    const historico = Array.isArray(input?.historico) ? input.historico : [];
    return {
      profileId: requireId(input?.profileId, "profileId"),
      mensagem,
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
  })
  .handler(async ({ data, context }): Promise<ChatReply> => {
    const { responderChat } = await import("@/integrations/ai/chat/chat.server");
    return responderChat(context.user.id, data);
  });
