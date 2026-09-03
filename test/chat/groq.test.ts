import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ChatProviderError, completarChat } from "@/integrations/ai/chat/groq.server";

/**
 * O cliente do provedor, com a rede substituída.
 *
 * O que se testa aqui não é a Groq: é o que o app faz com o que ela responde.
 * Cota estourada, chave recusada e modelo inexistente são os três erros que a
 * pessoa vai encontrar de verdade, e cada um precisa virar uma frase que diga
 * o que fazer — não um "erro interno" que manda todo mundo abrir um chamado.
 */

const fetchOriginal = globalThis.fetch;

function responderCom(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function completar() {
  return completarChat({
    messages: [{ role: "user", content: "quanto gastei?" }],
    userId: "usuario-de-teste",
  });
}

beforeEach(() => {
  process.env["GROQ_API_KEY"] = "chave-de-teste";
  process.env["MODELO_IA_CHAT"] = "modelo-de-teste";
  // O log do chat obedece às variáveis LOG_IA*; desligado, o teste não polui a saída.
  process.env["LOG_IA"] = "false";
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env["GROQ_API_KEY"];
  delete process.env["MODELO_IA_CHAT"];
  delete process.env["LOG_IA"];
});

describe("completarChat", () => {
  test("devolve o conteúdo cru e o consumo de tokens", async () => {
    responderCom(200, {
      model: "modelo-de-teste",
      choices: [
        { message: { content: '{"acao":"conversar","mensagem":"oi"}' }, finish_reason: "stop" },
      ],
      usage: { total_tokens: 123 },
    });

    const resposta = await completar();
    expect(resposta.content).toBe('{"acao":"conversar","mensagem":"oi"}');
    expect(resposta.totalTokens).toBe(123);
  });

  test("manda o modelo configurado, a chave e o modo JSON", async () => {
    let enviado: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      enviado = { url, init };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await completar();

    expect(enviado!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const headers = enviado!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer chave-de-teste");
    const corpo = JSON.parse(String(enviado!.init.body)) as Record<string, unknown>;
    expect(corpo["model"]).toBe("modelo-de-teste");
    expect(corpo["temperature"]).toBe(0);
    expect(corpo["response_format"]).toEqual({ type: "json_object" });
  });

  test("cota estourada vira aviso de esperar, não erro genérico", async () => {
    responderCom(429, { error: { message: "Rate limit reached" } });
    await expect(completar()).rejects.toThrow(/limite gratuito/i);
  });

  test("chave recusada aponta a variável a corrigir", async () => {
    responderCom(401, { error: { message: "Invalid API Key" } });
    await expect(completar()).rejects.toThrow(/GROQ_API_KEY/);
  });

  test("modelo inexistente aponta a variável a corrigir", async () => {
    responderCom(404, { error: { message: "model not found" } });
    await expect(completar()).rejects.toThrow(/MODELO_IA_CHAT/);
  });

  test("resposta cortada por tamanho é dita, e não vira erro de parse", async () => {
    responderCom(200, {
      choices: [{ message: { content: '{"acao":"regist' }, finish_reason: "length" }],
    });
    await expect(completar()).rejects.toThrow(ChatProviderError);
  });

  test("sem chave configurada, a falha é de configuração e nada é enviado", async () => {
    delete process.env["GROQ_API_KEY"];
    let chamou = false;
    globalThis.fetch = (async () => {
      chamou = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await expect(completar()).rejects.toThrow(/GROQ_API_KEY/);
    expect(chamou).toBe(false);
  });
});
