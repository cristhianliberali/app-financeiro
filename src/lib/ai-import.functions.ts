import { createServerFn } from "@tanstack/react-start";

import { requirePlano } from "@/integrations/postgres/auth-middleware";

export type ParsedRow = {
  description: string;
  amount: number;
  kind: "income" | "expense";
  date: string;
  due_date: string;
  category: string;
  installment_no: number | null;
  installment_total: number | null;
  /** O valor foi conferido no texto do documento. */
  amountFound: boolean;
  /** Lançamento igual que o perfil já tem: mesma descrição, valor e data. */
  duplicateOf: { id: string; description: string; date: string } | null;
  /** Não casa com nenhuma linha datada do documento: provável total ou resumo. */
  looksLikeSummary: boolean;
  /** Liga as parcelas de uma mesma compra. */
  installment_group: string | null;
  /** Parcela que ainda não está nesta fatura, projetada a partir de "03/10". */
  projected: boolean;
};

export type ImportSummary = {
  importId: string;
  source: string;
  totalBatches: number;
  totalTokens: number;
  expiresInMinutes: number;
};

export type BatchResult = {
  rows: ParsedRow[];
  batchNumber: number;
  totalBatches: number;
  done: boolean;
  /** Lançamentos que a IA só devolveu quando o servidor cobrou o que faltava. */
  recovered: number;
  /** Linhas com data e valor que continuaram sem lançamento. */
  missing: number;
  /** Linhas devolvidas que parecem total ou resumo, e não lançamento. */
  summaryRows: number;
  /** Lotes de cabeçalho/resumo que não chegaram a ir para a IA. */
  skippedBatches: number;
  /** Parcelas futuras projetadas a partir das linhas parceladas. */
  projectedRows: number;
};

/** Extensões que o servidor sabe converter em texto. */
export const ACCEPTED_UPLOAD = ".pdf,.docx,.doc,.xlsx,.xlsm,.xls,.csv,.txt,.ofx";

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

/** Diz à tela se a importação por IA está configurada neste ambiente. */
export const getImportConfig = createServerFn({ method: "GET" })
  .middleware([requirePlano])
  .handler(async (): Promise<{ enabled: boolean; provider: string; model: string | null }> => {
    const { getAiSettings } = await import("@/integrations/postgres/config.server");
    try {
      const settings = getAiSettings();
      return { enabled: true, provider: settings.provider, model: settings.model };
    } catch {
      return { enabled: false, provider: "openai", model: null };
    }
  });

/**
 * Lê o documento e o divide em lotes. Não gasta IA — devolve só o resumo, e o
 * usuário dispara cada lote em seguida.
 */
export const prepareImport = createServerFn({ method: "POST" })
  .middleware([requirePlano])
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
  .handler(async ({ data, context }): Promise<ImportSummary> => {
    const { prepareImport: run } = await import("@/integrations/ai/import.server");
    return run(context.user.id, data);
  });

/** Processa o próximo lote pendente — uma requisição de IA por chamada. */
export const processNextBatch = createServerFn({ method: "POST" })
  .middleware([requirePlano])
  .inputValidator((input: { importId: string; profileId: string }) => ({
    importId: requireId(input?.importId, "importId"),
    profileId: requireId(input?.profileId, "profileId"),
  }))
  .handler(async ({ data, context }): Promise<BatchResult> => {
    const { processNextBatch: run } = await import("@/integrations/ai/import.server");
    return run(context.user.id, data);
  });
