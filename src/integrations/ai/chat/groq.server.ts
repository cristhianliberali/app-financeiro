/**
 * Cliente do provedor do chat (Groq) — texto, imagem e áudio.
 *
 * É um `fetch` direto, e não o SDK da OpenAI que a importação de faturas usa.
 * As chamadas precisam de poucos campos da resposta (`content`, `text`,
 * `usage`, `error`) e de um endereço configurável; o SDK não acrescentaria
 * nada a isso e traria junto a tipagem dos modelos da OpenAI, que não são os da
 * Groq. Como a API da Groq é compatível com `/chat/completions` e
 * `/audio/transcriptions`, o mesmo código serve para qualquer serviço
 * compatível apontado por `GROQ_BASE_URL`.
 *
 * São três modelos diferentes, cada um com a sua variável de ambiente, porque
 * são três trabalhos diferentes: classificar uma frase, ler uma imagem e
 * transcrever um áudio. Um modelo que faz os três bem seria mais caro nos três.
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

/** Resposta de `/audio/transcriptions`. */
type TranscricaoResponse = { text?: string; error?: { message?: string } };

/** Qual das três chamadas está em curso — aparece no log para poder separá-las. */
type Canal = "chat" | "visão" | "áudio";

/** Erro que a tela pode mostrar como está — sem vazar chave nem stack. */
export class ChatProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderError";
  }
}

/** Trinta segundos: passou disso, a pessoa já desistiu de esperar por uma frase. */
const TIMEOUT_MS = 30_000;
/** O áudio sobe um arquivo e é transcrito; é mais lento que uma frase de texto. */
const TIMEOUT_AUDIO_MS = 60_000;

/** Corta o trecho no limite configurado, dizendo quanto ficou de fora. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (+${text.length - maxChars} caracteres omitidos)`;
}

/**
 * Log das duas pontas de cada chamada, no mesmo formato do resto da IA do app:
 * é o que permite descobrir depois se uma resposta estranha veio do prompt, da
 * frase da pessoa ou do modelo. Obedece às mesmas variáveis `LOG_IA*`.
 */
function logIa(
  canal: Canal,
  userId: string,
  fase: "→ requisição" | "← resposta",
  cabecalho: string,
  linhas: Array<[string, string]> = [],
): void {
  const settings = getAiLogSettings();
  if (!settings.enabled) return;

  const tag = `[chat-ia:${canal}] usuário=${userId}`;
  if (!settings.includeBody || linhas.length === 0) {
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

/**
 * A parte que as três chamadas têm em comum: enviar, esperar, ler o JSON e
 * traduzir a falha numa frase que diga o que fazer.
 *
 * O nome da variável de ambiente do modelo entra como parâmetro porque é o que
 * torna o erro 404 acionável: "o modelo X não existe, confira MODELO_IA_VISAO"
 * resolve sozinho; "modelo não encontrado" manda a pessoa procurar.
 */
async function requisitar<T extends { error?: { message?: string } }>(input: {
  canal: Canal;
  userId: string;
  caminho: string;
  init: RequestInit;
  modelo: string;
  variavelDoModelo: string;
  timeoutMs?: number;
}): Promise<{ payload: T; durationMs: number }> {
  const settings = getChatSettings();
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}${input.caminho}`, {
      ...input.init,
      headers: { authorization: `Bearer ${settings.apiKey}`, ...input.init.headers },
      signal: AbortSignal.timeout(input.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(
      `[chat-ia:${input.canal}] usuário=${input.userId} ✕ falhou depois de ${durationMs}ms:`,
      error,
    );
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ChatProviderError("A IA demorou demais para responder. Tente de novo.");
    }
    throw new ChatProviderError("Não consegui falar com a IA agora. Tente de novo em instantes.");
  }
  const durationMs = Date.now() - startedAt;

  const bruto = await response.text();
  let payload: T;
  try {
    payload = JSON.parse(bruto) as T;
  } catch {
    console.error(
      `[chat-ia:${input.canal}] usuário=${input.userId} ✕ resposta não é JSON:`,
      clip(bruto, 500),
    );
    throw new ChatProviderError("A IA devolveu uma resposta que não consegui ler.");
  }

  if (!response.ok) {
    const detalhe = payload.error?.message ?? `HTTP ${response.status}`;
    console.error(
      `[chat-ia:${input.canal}] usuário=${input.userId} ✕ ${response.status}: ${detalhe}`,
    );
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
        `O modelo "${input.modelo}" não existe no provedor. Confira ${input.variavelDoModelo}.`,
      );
    }
    if (response.status === 413) {
      throw new ChatProviderError("O arquivo é grande demais para o provedor. Use um menor.");
    }
    throw new ChatProviderError(`A IA recusou a requisição: ${detalhe}`);
  }

  return { payload, durationMs };
}

/** Extrai o texto de uma resposta de `/chat/completions`, com os erros do meio. */
function textoDaEscolha(canal: Canal, payload: GroqResponse, ondeCortou: string): string {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? "";

  // Resposta cortada no meio vira JSON inválido (ou transcrição pela metade);
  // dizer isso é melhor do que deixar o erro aparecer sem explicação.
  if (choice?.finish_reason === "length") throw new ChatProviderError(ondeCortou);
  if (!content.trim()) {
    throw new ChatProviderError(
      canal === "visão"
        ? "A IA não conseguiu ler nada nesta imagem."
        : "A IA não devolveu resposta.",
    );
  }
  return content;
}

// ───────────────────────────────── texto ────────────────────────────────────

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

  logIa(
    "chat",
    input.userId,
    "→ requisição",
    `provedor=${settings.provider} modelo=${settings.model} mensagens=${input.messages.length}`,
    [
      ["system", sistema],
      ["conversa", conversa],
    ],
  );

  const { payload, durationMs } = await requisitar<GroqResponse>({
    canal: "chat",
    userId: input.userId,
    caminho: "/chat/completions",
    modelo: settings.model,
    variavelDoModelo: "MODELO_IA_CHAT",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages: input.messages,
        // A tarefa é classificar uma frase num contrato fechado: criatividade
        // aqui só produz campo fora do combinado.
        temperature: 0,
        max_tokens: settings.maxTokens,
        response_format: { type: "json_object" },
      }),
    },
  });

  const modelo = payload.model ?? settings.model;
  const totalTokens = payload.usage?.total_tokens ?? null;

  logIa(
    "chat",
    input.userId,
    "← resposta",
    `modelo=${modelo} ${durationMs}ms tokens=${totalTokens ?? "?"} ` +
      `fim=${payload.choices?.[0]?.finish_reason ?? "?"}`,
    [["conteúdo", payload.choices?.[0]?.message?.content ?? ""]],
  );

  const content = textoDaEscolha(
    "chat",
    payload,
    "A resposta da IA foi cortada por tamanho. Tente uma frase mais curta.",
  );

  return { content, model: modelo, durationMs, totalTokens };
}

// ───────────────────────────────── imagem ───────────────────────────────────

export type TranscricaoMidia = {
  /** O texto que o modelo leu — é ele que segue para a segunda requisição. */
  texto: string;
  model: string;
  durationMs: number;
  totalTokens: number | null;
};

/**
 * Lê uma imagem e devolve **texto**, não intenção.
 *
 * Esta chamada não interpreta nada: ela transcreve o que está escrito no
 * comprovante. Quem decide o que fazer com o resultado é a segunda requisição,
 * ao modelo de texto padrão, com o mesmo contrato de sempre. Separar as duas
 * mantém o contrato num lugar só — e deixa trocar de modelo de visão sem
 * mexer em nenhuma regra de negócio.
 */
export async function transcreverImagem(input: {
  /** Imagem em base64, sem o prefixo `data:`. */
  base64: string;
  mime: string;
  prompt: string;
  userId: string;
}): Promise<TranscricaoMidia> {
  const settings = getChatSettings();

  logIa(
    "visão",
    input.userId,
    "→ requisição",
    `modelo=${settings.visionModel} tipo=${input.mime} ` +
      `tamanho≈${Math.round((input.base64.length * 3) / 4 / 1024)}kB`,
    [["prompt", input.prompt]],
  );

  const { payload, durationMs } = await requisitar<GroqResponse>({
    canal: "visão",
    userId: input.userId,
    caminho: "/chat/completions",
    modelo: settings.visionModel,
    variavelDoModelo: "MODELO_IA_VISAO",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.visionModel,
        /*
         * Sem mensagem de sistema: parte dos modelos de visão da Groq recusa a
         * requisição quando ela vem junto de uma imagem. A instrução vai no
         * próprio turno do usuário, ao lado da imagem, que todos aceitam.
         */
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: input.prompt },
              {
                type: "image_url",
                image_url: { url: `data:${input.mime};base64,${input.base64}` },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: settings.visionMaxTokens,
      }),
    },
  });

  const model = payload.model ?? settings.visionModel;
  const totalTokens = payload.usage?.total_tokens ?? null;
  const texto = textoDaEscolha(
    "visão",
    payload,
    "A leitura da imagem foi cortada por tamanho. Envie um recorte com menos texto.",
  );

  logIa(
    "visão",
    input.userId,
    "← resposta",
    `modelo=${model} ${durationMs}ms tokens=${totalTokens ?? "?"} caracteres=${texto.length}`,
    [["texto extraído", texto]],
  );

  return { texto: texto.trim(), model, durationMs, totalTokens };
}

// ────────────────────────────────── áudio ───────────────────────────────────

/**
 * Transcreve um áudio.
 *
 * É `/audio/transcriptions` — um modelo de fala, não o de chat. A transcrição
 * acontece "em código", antes de qualquer interpretação: o que sai daqui é
 * texto, e esse texto entra no fluxo normal como se a pessoa o tivesse
 * digitado. Nenhuma regra do chat precisa saber que houve um áudio.
 */
export async function transcreverAudio(input: {
  /** Áudio em base64, sem o prefixo `data:`. */
  base64: string;
  mime: string;
  nome: string;
  userId: string;
}): Promise<TranscricaoMidia> {
  const settings = getChatSettings();
  const bytes = Buffer.from(input.base64, "base64");

  logIa(
    "áudio",
    input.userId,
    "→ requisição",
    `modelo=${settings.audioModel} tipo=${input.mime} ` +
      `tamanho=${Math.round(bytes.byteLength / 1024)}kB`,
  );

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: input.mime }), input.nome);
  form.append("model", settings.audioModel);
  form.append("response_format", "json");
  // O app é em português; dizer o idioma evita que uma gravação curta e com
  // ruído seja transcrita como se fosse outra língua.
  form.append("language", "pt");
  form.append("temperature", "0");

  const { payload, durationMs } = await requisitar<TranscricaoResponse>({
    canal: "áudio",
    userId: input.userId,
    caminho: "/audio/transcriptions",
    modelo: settings.audioModel,
    variavelDoModelo: "MODELO_IA_AUDIO",
    timeoutMs: TIMEOUT_AUDIO_MS,
    // Sem `content-type`: o `fetch` precisa gerar o boundary do multipart.
    init: { method: "POST", body: form },
  });

  const texto = (payload.text ?? "").trim();

  logIa(
    "áudio",
    input.userId,
    "← resposta",
    `modelo=${settings.audioModel} ${durationMs}ms caracteres=${texto.length}`,
    [["transcrição", texto]],
  );

  if (!texto) {
    throw new ChatProviderError(
      "Não consegui entender o áudio. Grave de novo, mais perto do microfone.",
    );
  }

  return { texto, model: settings.audioModel, durationMs, totalTokens: null };
}
