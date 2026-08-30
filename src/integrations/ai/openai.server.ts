/**
 * Chamada ao provedor de IA.
 *
 * Hoje só OpenAI (`PROVEDOR_IA=openai`). A saída é presa a um JSON Schema com
 * `strict: true`, então a resposta já chega no formato que a tela espera — sem
 * texto solto para tentar interpretar depois.
 */
import { getAiSettings } from "../postgres/config.server";
import { logAiError, logAiRequest, logAiResponse, type AiLogContext } from "./logs.server";

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
          date: {
            type: "string",
            description:
              "Data do lançamento (quando a compra/movimento aconteceu), YYYY-MM-DD. Obrigatória.",
          },
          due_date: {
            type: "string",
            description:
              "Data de vencimento (quando o valor é cobrado/pago), YYYY-MM-DD. Obrigatória: " +
              "numa fatura de cartão é o vencimento da fatura, igual para todas as linhas.",
          },
          category: { type: "string", description: "Uma das categorias oferecidas" },
          installment_no: { type: ["integer", "null"] },
          installment_total: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

function buildSystemPrompt(
  categories: CategoryHint[],
  today: string,
  /** Segunda passada: só as linhas que ficaram de fora da primeira. */
  recovery: boolean,
): string {
  const list = categories.length
    ? categories
        .map((c) =>
          c.description?.trim() ? `- ${c.name}: ${c.description.trim()}` : `- ${c.name}`,
        )
        .join("\n")
    : "- Outros";

  const recoveryRules = recovery
    ? [
        "",
        "Estas linhas ficaram de fora da extração anterior deste mesmo documento.",
        "Devolva um lançamento para cada linha que for de fato um lançamento.",
        "Se alguma linha for total, saldo, limite, resumo ou cabeçalho, simplesmente não a devolva.",
        "Cada linha vem completa: quando a descrição estava quebrada em duas, as duas já foram juntadas.",
      ]
    : [];

  const contextRules = [
    "",
    "O trecho pode começar com um bloco CABEÇALHO DO DOCUMENTO, entre marcadores.",
    "Ele existe só para você saber datas e vencimento: não gere lançamento nenhum a partir dele.",
    "",
    "Um lançamento tem sempre data própria no documento. Linha com valor e sem data é",
    "total, saldo, limite ou resumo — inclusive quando o nome parece de lançamento",
    '("FATURA ANTERIOR", "PAGAMENTOS RECEBIDOS", "ENCARGOS", "DESPESAS/DÉBITOS",',
    "resumo por categoria). Nada disso é lançamento.",
    "Se o trecho não tiver nenhum lançamento, devolva a lista vazia. Lista vazia é uma",
    "resposta correta; inventar lançamento a partir de um total, não.",
  ];

  return [
    "Você extrai lançamentos financeiros de faturas de cartão e extratos bancários brasileiros.",
    `Hoje é ${today}.`,
    ...recoveryRules,
    ...contextRules,
    "",
    "Regras:",
    "- Uma linha de saída para cada lançamento do documento. Não invente lançamentos.",
    "- Devolva TODOS os lançamentos, do primeiro ao último. Não resuma, não agrupe e não pare no meio:",
    "  uma linha do documento que ficar sem lançamento é um erro.",
    "- Copie os valores exatamente como aparecem, convertidos para número.",
    "- O documento pode usar vírgula ou ponto como separador decimal: o separador dos centavos é",
    '  sempre o último. "1.234,56" e "1,234.56" são o mesmo valor, 1234.56.',
    "- Valores sempre positivos: use kind=expense para gastos e kind=income para créditos, estornos e recebimentos.",
    "- Datas em YYYY-MM-DD. Quando o documento traz só dia e mês, use o ano mais provável em relação a hoje.",
    "",
    "As duas datas são obrigatórias e significam coisas diferentes:",
    "- date: quando a compra ou o movimento aconteceu (a data que aparece ao lado da linha).",
    "- due_date: quando o valor é efetivamente cobrado ou pago.",
    "  Em fatura de cartão, é a data de vencimento da fatura — a mesma para todas as linhas,",
    "  inclusive as de meses anteriores e as parcelas. Procure-a no cabeçalho do documento.",
    "  Em extrato bancário, o movimento já aconteceu: repita a data de date.",
    "  Só repita date em due_date quando o documento realmente não informar vencimento.",
    "",
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
  /** Quem pediu; vai para o log das duas pontas da requisição. */
  log: AiLogContext;
  /** Segunda passada, com as linhas que a primeira deixou passar. */
  recovery?: boolean;
  /** Começo do documento, só como referência de datas e vencimento. */
  header?: string;
}): Promise<ExtractedRow[]> {
  const settings = getAiSettings();
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: settings.apiKey });

  const systemPrompt = buildSystemPrompt(
    input.categories,
    new Date().toISOString().slice(0, 10),
    input.recovery ?? false,
  );

  // O cabeçalho entra marcado, para o modelo saber o que é referência e o que é
  // conteúdo a extrair.
  const userText = input.header?.trim()
    ? [
        "===== CABEÇALHO DO DOCUMENTO (referência, não extraia) =====",
        input.header.trim(),
        "===== FIM DO CABEÇALHO. Extraia os lançamentos do trecho abaixo. =====",
        input.text,
      ].join("\n")
    : input.text;

  logAiRequest(input.log, {
    provider: settings.provider,
    model: settings.model,
    systemPrompt,
    userText,
    categories: input.categories.length,
  });

  const startedAt = Date.now();
  let response;
  try {
    response = await client.chat.completions.create({
      model: settings.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "lancamentos", strict: true, schema: ROW_SCHEMA as never },
      },
    });
  } catch (error) {
    logAiError(input.log, error, Date.now() - startedAt);
    throw error;
  }
  const durationMs = Date.now() - startedAt;

  const choice = response.choices[0];

  // Resposta cortada no meio: o JSON chega inválido e, pior, faltando
  // lançamentos. Vale mais dizer isso do que estourar um erro de parse.
  if (choice?.finish_reason === "length") {
    logAiResponse(input.log, {
      model: response.model ?? settings.model,
      durationMs,
      rows: 0,
      content: choice.message?.content ?? "",
      usage: response.usage ?? null,
    });
    throw new Error(
      "A resposta da IA foi cortada por tamanho — o lote tem lançamentos demais. " +
        "Reduza LIMITE_LANCAMENTOS_LOTE no servidor e envie o documento de novo.",
    );
  }

  if (choice?.message?.refusal) {
    logAiError(input.log, new Error(choice.message.refusal), durationMs);
    throw new Error(`A IA recusou a extração: ${choice.message.refusal}`);
  }

  const content = choice?.message?.content;
  if (!content) {
    logAiResponse(input.log, {
      model: response.model ?? settings.model,
      durationMs,
      rows: 0,
      content: JSON.stringify(choice ?? null),
      usage: response.usage ?? null,
    });
    throw new Error("A IA não devolveu nenhum lançamento.");
  }

  const parsed = JSON.parse(content) as { rows?: ExtractedRow[] };
  const rows = parsed.rows ?? [];

  logAiResponse(input.log, {
    model: response.model ?? settings.model,
    durationMs,
    rows: rows.length,
    content,
    usage: response.usage ?? null,
  });

  return rows;
}
