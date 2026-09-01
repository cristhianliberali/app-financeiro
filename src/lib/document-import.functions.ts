/**
 * Importação de documentos em duas etapas.
 *
 * Etapa 1 (esta): o servidor extrai as transações do arquivo por código, sem
 * nenhuma requisição de IA, e a tela mostra tudo de uma vez. Etapa 2 (botão
 * "Categorizar com IA"): só as decisões de categoria vão para o modelo — as
 * categorias disponíveis e as linhas numeradas, nunca o arquivo inteiro.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";
import type { ExtracaoParaTela } from "@/integrations/ai/pipeline/extracao.server";

export type {
  ConferenciaExtracao,
  ExtracaoParaTela,
  TotalConferido,
  TransacaoExtraida,
} from "@/integrations/ai/pipeline/extracao.server";

/** Extensões que a extração sabe ler. */
export const ACCEPTED_UPLOAD = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv,.txt,.ofx";

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

/**
 * Extrai as transações do documento, de uma vez só. Determinístico: reprocessar
 * o mesmo arquivo devolve exatamente o mesmo resultado, e não gasta IA.
 */
export const extractDocument = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator(
    (input: { profileId: string; text?: string; file?: { name: string; base64: string } }) => {
      const profileId = requireId(input?.profileId, "profileId");
      if (input?.file) {
        if (typeof input.file.name !== "string" || typeof input.file.base64 !== "string") {
          throw new Error("Arquivo inválido");
        }
        return { profileId, file: { name: input.file.name, base64: input.file.base64 } };
      }
      const text = typeof input?.text === "string" ? input.text.trim() : "";
      if (text.length < 10) throw new Error("Cole o texto da fatura ou anexe um arquivo");
      return { profileId, text };
    },
  )
  .handler(async ({ data, context }): Promise<ExtracaoParaTela> => {
    const { requireProfileAccess } = await import("@/integrations/postgres/access.server");
    await requireProfileAccess(context.user.id, data.profileId, "editor");

    const { extrairParaTela } = await import("@/integrations/ai/pipeline/extracao.server");
    const extracao = await extrairParaTela(data);

    console.info(
      `[importação] extração determinística: usuário=${context.user.id} ` +
        `perfil=${data.profileId} origem=${extracao.origem} ` +
        `linhas=${extracao.estatisticas.linhas} transações=${extracao.transacoes.length} ` +
        `não_interpretadas=${extracao.naoInterpretadas.length} ` +
        `conferência=${extracao.conferencia.disponivel ? (extracao.conferencia.fechouTudo ? "fechou" : "aberta") : "sem totais"}`,
    );

    return extracao;
  });
