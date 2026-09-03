import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getChatConfig,
  sendChatMessage,
  type HistoricoChat,
  type MidiaChat,
} from "./chat.functions";
import { upsertRows } from "./data.functions";
import { buildInstallments, installmentLabel } from "./installments";
import type { ChatReply, OrigemMidia, RascunhoLancamento } from "./chat-contract";

export type { ChatReply, OrigemMidia, RascunhoLancamento, HistoricoChat, MidiaChat };

/** Está configurado neste ambiente? A tela esconde o assistente quando não. */
export function useChatConfig() {
  return useQuery({
    queryKey: ["chat-config"],
    // A configuração é variável de ambiente: só muda quando o servidor
    // reinicia, então não vale reperguntar a cada foco de janela.
    staleTime: 5 * 60 * 1000,
    queryFn: () => getChatConfig(),
  });
}

/**
 * Envia a mensagem — texto, ou texto com um anexo.
 *
 * Com imagem ou áudio, o servidor faz uma requisição a mais antes de
 * interpretar: o anexo vira texto, e é esse texto que o modelo de chat recebe.
 * A tela não precisa saber disso; ela só ganha `origem` na resposta, com o que
 * foi extraído, para mostrar à pessoa.
 */
export function useChatMessage() {
  return useMutation({
    mutationFn: (input: {
      profileId: string;
      mensagem: string;
      historico: HistoricoChat[];
      imagem?: MidiaChat;
      audio?: MidiaChat;
    }): Promise<ChatReply> => sendChatMessage({ data: input }),
  });
}

/**
 * Grava o rascunho confirmado.
 *
 * É o único ponto do chat que escreve, e ele roda depois do clique em
 * confirmar — nunca a partir da resposta da IA. Passa pelo mesmo `upsertRows`
 * do formulário manual, então herda de graça as checagens de permissão, a
 * exigência de categoria no servidor e a invalidação das telas.
 *
 * A compra parcelada vira N lançamentos aqui, com a mesma divisão de centavos
 * e o mesmo padrão de nome ("DESCRIÇÃO k/n") do formulário: duas formas de
 * lançar a mesma coisa não podem produzir dados diferentes.
 */
export function useConfirmarRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profileId: string; rascunho: RascunhoLancamento }) => {
      const { rascunho } = input;
      if (!rascunho.category_id) throw new Error("Escolha uma categoria para o lançamento");
      if (!(rascunho.amount > 0)) throw new Error("Informe um valor maior que zero");
      if (!rascunho.description.trim()) throw new Error("Informe a descrição");

      const base = {
        profile_id: input.profileId,
        category_id: rascunho.category_id,
        kind: rascunho.kind,
        status: rascunho.status,
        // Marca de onde o lançamento veio: útil quando alguém revisa o extrato
        // meses depois e quer saber por que aquela descrição está tão curta.
        notes: "Lançado pelo assistente de IA",
      };

      if (rascunho.parcelas > 1) {
        const group = crypto.randomUUID();
        const partes = buildInstallments({
          total: rascunho.amount,
          count: rascunho.parcelas,
          firstDueDate: rascunho.due_date,
        });
        await upsertRows({
          data: {
            table: "transactions",
            rows: partes.map((parte) => ({
              ...base,
              description: installmentLabel(rascunho.description, parte.no, parte.total),
              amount: parte.amount,
              transaction_date: rascunho.transaction_date,
              due_date: parte.due_date,
              installment_no: parte.no,
              installment_total: parte.total,
              installment_group: group,
            })),
          },
        });
        return { criados: partes.length };
      }

      await upsertRows({
        data: {
          table: "transactions",
          rows: {
            ...base,
            description: rascunho.description.trim(),
            amount: rascunho.amount,
            transaction_date: rascunho.transaction_date,
            due_date: rascunho.due_date,
          },
        },
      });
      return { criados: 1 };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transactions"] }),
  });
}
