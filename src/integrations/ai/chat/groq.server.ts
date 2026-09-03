/**
 * Cliente do provedor do chat (Groq).
 *
 * É um `fetch` direto, e não o SDK da OpenAI que a importação de faturas usa.
 * A chamada precisa de três campos da resposta (`content`, `usage`, `error`) e
 * de um endereço configurável; o SDK não acrescentaria nada a isso e traria
 * junto a tipagem dos modelos da OpenAI, que não são os da Groq. Como a API da
 * Groq é compatível com `/chat/completions`, o mesmo código serve para
 * qualquer serviço compatível apontado por `GROQ_BASE_URL`.
 *
 * O modo JSON (`response_format: json_object`) obriga a resposta a ser um
 * objeto JSON válido — não que ela obedeça ao nosso contrato. Quem garante o
 * contrato é `parseIntent`, depois.
 */
import { getAiLogSettings, getChatSettings } from "../../postgres/config.server";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompletion = {
  /** O JSON cru devolvido pelo modelo, ainda sem validar. */
  content: string;
  model: string;
  durationMs: number;
  totalTokens: number | null;
};

type GroqResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string };
};

/** Corta o trecho no limite configurado, dizendo quanto ficou de fora. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (+${text.length - maxChars} caracteres omitidos)`;
}

/**
 * Log das duas pontas da chamada, no mesmo formato do resto da IA do app: é o
 * que permite descobrir depois se uma resposta estranha veio do prompt, da
 * frase da pessoa ou do modelo. Obedece às mesmas variáveis `LOG_IA*`.
 */
function logChat(
  userId: string,
  fase: "→ requisição" | "← resposta",
  linhas: Array<[string, string]>,
  cabecalho: string,
): void {
  const settings = getAiLogSettings();
  if (!settings.enabled) return;

  const tag = `[chat-ia] usuário=${userId}`;
  if (!settings.includeBody) {
    console.info(`${tag} ${fase}: ${cabecalho}`);
    return;
  }

  console.info(
    [
      `${tag} ${fase}: ${cabecalho}`,
      ...linhas.flatMap(([titulo, corpo]) => [`--- ${titulo} ---`, clip(corpo, settings.maxChars)]),
      "--- fim ---",
    ].join("\n"),
  );
}

/** Erro que a tela pode mostrar como está — sem vazar chave nem stack. */
export class ChatProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderError";
  }
}

/** Trinta segundos: passou disso, a pessoa já desistiu de esperar por uma frase. */
const TIMEOUT_MS = 30_000;

export async function completarChat(input: {
  messages: ChatMessage[];
  /** Só para o log — a chamada não guarda nada em banco. */
  userId: string;
}): Promise<ChatCompletion> {
  const settings = getChatSettings();

  const sistema = input.messages.find((m) => m.role === "system")?.content ?? "";
  const conversa = input.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  logChat(
    input.userId,
    "→ requisição",
    [
      ["system", sistema],
      ["conversa", conversa],
    ],
    `provedor=${settings.provider} modelo=${settings.model} mensagens=${input.messages.length}`,
  );

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages: input.messages,
        // A tarefa é classificar uma frase num contrato fechado: criatividade
        // aqui só produz campo fora do combinado.
        temperature: 0,
        max_tokens: settings.maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[chat-ia] usuário=${input.userId} ✕ falhou depois de ${durationMs}ms:`, error);
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ChatProviderError("A IA demorou demais para responder. Tente de novo.");
    }
    throw new ChatProviderError("Não consegui falar com a IA agora. Tente de novo em instantes.");
  }
  const durationMs = Date.now() - startedAt;

  const bruto = await response.text();
  let payload: GroqResponse;
  try {
    payload = JSON.parse(bruto) as GroqResponse;
  } catch {
    console.error(`[chat-ia] usuário=${input.userId} ✕ resposta não é JSON:`, clip(bruto, 500));
    throw new ChatProviderError("A IA devolveu uma resposta que não consegui ler.");
  }

  if (!response.ok) {
    const detalhe = payload.error?.message ?? `HTTP ${response.status}`;
    console.error(`[chat-ia] usuário=${input.userId} ✕ ${response.status}: ${detalhe}`);
    // A cota gratuita da Groq é por minuto e por dia; quando ela estoura, a
    // pessoa precisa saber que é só esperar, e não que o app quebrou.
    if (response.status === 429) {
      throw new ChatProviderError(
        "O limite gratuito da IA foi atingido por agora. Tente de novo em alguns minutos.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ChatProviderError(
        "A chave da IA foi recusada pelo provedor. Confira GROQ_API_KEY no servidor.",
      );
    }
    if (response.status === 404) {
      throw new ChatProviderError(
        `O modelo "${settings.model}" não existe no provedor. Confira MODELO_IA_CHAT.`,
      );
    }
    throw new ChatProviderError(`A IA recusou a requisição: ${detalhe}`);
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? "";
  const totalTokens = payload.usage?.total_tokens ?? null;

  logChat(
    input.userId,
    "← resposta",
    [["conteúdo", content]],
    `modelo=${payload.model ?? settings.model} ${durationMs}ms tokens=${totalTokens ?? "?"} ` +
      `fim=${choice?.finish_reason ?? "?"}`,
  );

  // Resposta cortada no meio vira JSON inválido; dizer isso é melhor do que
  // deixar o `JSON.parse` estourar um erro de sintaxe sem explicação.
  if (choice?.finish_reason === "length") {
    throw new ChatProviderError(
      "A resposta da IA foi cortada por tamanho. Tente uma frase mais curta.",
    );
  }

  if (!content.trim()) throw new ChatProviderError("A IA não devolveu resposta.");

  return {
    content,
    model: payload.model ?? settings.model,
    durationMs,
    totalTokens,
  };
}
