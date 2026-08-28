/**
 * Chamada ao provedor de IA.
 *
 * Hoje só OpenAI (`PROVEDOR_IA=openai`). A saída é presa a um JSON Schema com
 * `strict: true`, então a resposta já chega no formato que a tela espera — sem
 * texto solto para tentar interpretar depois.
 */
import { getAiSettings } from "../postgres/config.server";

export type ExtractedRow = {
  description: string;
  amount: number;
  kind: "income" | "expense";
  date: string;
  due_date: string;
  category: string;
  installment_no: number | null;
  installment_total: number | null;
};

export type CategoryHint = { name: string; description: string | null };

const ROW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "description",
          "amount",
          "kind",
          "date",
          "due_date",
          "category",
          "installment_no",
          "installment_total",
        ],
        properties: {
          description: { type: "string", description: "Nome do estabelecimento ou do lançamento" },
          amount: { type: "number", description: "Valor absoluto, sempre positivo" },
          kind: { type: "string", enum: ["income", "expense"] },
          date: { type: "string", description: "Data do lançamento, YYYY-MM-DD" },
          due_date: { type: "string", description: "Vencimento, YYYY-MM-DD" },
          category: { type: "string", description: "Uma das categorias oferecidas" },
          installment_no: { type: ["integer", "null"] },
          installment_total: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

function buildSystemPrompt(categories: CategoryHint[], today: string): string {
  const list = categories.length
    ? categories
        .map((c) =>
          c.description?.trim() ? `- ${c.name}: ${c.description.trim()}` : `- ${c.name}`,
        )
        .join("\n")
    : "- Outros";

  return [
    "Você extrai lançamentos financeiros de faturas de cartão e extratos bancários brasileiros.",
    `Hoje é ${today}.`,
    "",
    "Regras:",
    "- Uma linha de saída para cada lançamento do documento. Não invente lançamentos.",
    "- Copie os valores exatamente como aparecem, convertidos para número (1.234,56 vira 1234.56).",
    "- Valores sempre positivos: use kind=expense para gastos e kind=income para créditos, estornos e recebimentos.",
    "- Datas em YYYY-MM-DD. Quando o documento traz só dia e mês, use o ano mais provável em relação a hoje.",
    "- Quando a linha indicar parcela (ex.: 03/10), preencha installment_no e installment_total.",
    "- Ignore cabeçalhos, totais, saldos, limites e linhas de resumo — só lançamentos.",
    "",
    "Escolha a categoria mais adequada entre as disponíveis. A descrição de cada uma traz",
    "palavras-chave que costumam aparecer na fatura; use-as para decidir.",
    "",
    "Categorias disponíveis:",
    list,
  ].join("\n");
}

export async function extractRows(input: {
  text: string;
  categories: CategoryHint[];
}): Promise<ExtractedRow[]> {
  const settings = getAiSettings();
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: settings.apiKey });

  const response = await client.chat.completions.create({
    model: settings.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(input.categories, new Date().toISOString().slice(0, 10)),
      },
      { role: "user", content: input.text },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "lancamentos", strict: true, schema: ROW_SCHEMA as never },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("A IA não devolveu nenhum lançamento.");

  const parsed = JSON.parse(content) as { rows?: ExtractedRow[] };
  return parsed.rows ?? [];
}
