import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "@/integrations/postgres/auth-middleware";

export type ParsedRow = {
  description: string;
  amount: number;
  kind: "income" | "expense";
  date: string;
  due_date: string;
  category: string;
  installment_no: number | null;
  installment_total: number | null;
};

export const parseStatement = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { text: string; categories: string[] }) => {
    if (!input?.text || input.text.trim().length < 10) throw new Error("Cole o texto da fatura");
    return { text: input.text.slice(0, 20000), categories: input.categories ?? [] };
  })
  .handler(async ({ data }): Promise<{ rows: ParsedRow[]; error?: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { rows: [], error: "IA indisponível no momento" };

    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          {
            role: "system",
            content:
              `Você extrai lançamentos financeiros de faturas de cartão e extratos bancários brasileiros. ` +
              `Hoje é ${today}. Datas no formato YYYY-MM-DD. Valores positivos. ` +
              `Use "expense" para gastos e "income" para créditos/estornos/recebimentos. ` +
              `Se o texto indicar parcela (ex: 2/5), preencha installment_no e installment_total. ` +
              `Escolha a categoria mais adequada entre: ${data.categories.join(", ") || "Outros"}. ` +
              `Responda apenas via a ferramenta.`,
          },
          { role: "user", content: data.text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "registrar_lancamentos",
              description: "Devolve a lista de lançamentos extraídos",
              parameters: {
                type: "object",
                properties: {
                  rows: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        amount: { type: "number" },
                        kind: { type: "string", enum: ["income", "expense"] },
                        date: { type: "string" },
                        due_date: { type: "string" },
                        category: { type: "string" },
                        installment_no: { type: ["number", "null"] },
                        installment_total: { type: ["number", "null"] },
                      },
                      required: ["description", "amount", "kind", "date", "due_date", "category"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["rows"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "registrar_lancamentos" } },
      }),
    });

    if (res.status === 429) return { rows: [], error: "Limite de uso da IA atingido. Tente novamente em instantes." };
    if (res.status === 402) return { rows: [], error: "Créditos de IA esgotados." };
    if (!res.ok) return { rows: [], error: "A IA não conseguiu processar o documento." };

    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { rows: [], error: "Nenhum lançamento identificado." };

    try {
      const parsed = JSON.parse(args) as { rows?: ParsedRow[] };
      return { rows: (parsed.rows ?? []).map((r) => ({ ...r, amount: Math.abs(Number(r.amount)) })) };
    } catch {
      return { rows: [], error: "Resposta da IA inválida." };
    }
  });
