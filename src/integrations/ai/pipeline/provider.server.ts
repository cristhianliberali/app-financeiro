/**
 * Provedor de LLM da camada 3.
 *
 * A camada de classificação só conhece esta interface: trocar de modelo, ou de
 * provedor inteiro, é mudança de configuração — nenhum teste da camada 3 chama
 * API de verdade, todos passam um cliente falso por aqui.
 *
 * A tarefa é `texto curto -> rótulo curto`, então não precisa de modelo caro. O
 * que decide entre um e outro não é benchmark: é rodar os dois contra a suíte
 * dourada e medir taxa de `faltando` e acerto de categoria.
 */
import { getAiSettings } from "../../postgres/config.server";

export type PedidoLlm = {
  sistema: string;
  usuario: string;
};

export type LlmClient = {
  /** Identificação para log e para comparar qualidade entre modelos. */
  readonly nome: string;
  completar(pedido: PedidoLlm): Promise<string>;
};

/**
 * Cliente da OpenAI.
 *
 * Sem `response_format`: a saída é uma linha de texto por decisão, e não JSON.
 * Pedir JSON aninhado aqui seria pagar para o modelo repetir nome de campo e
 * ganhar mais erro de formatação em troca.
 */
export function clienteOpenAi(config?: { modelo?: string; apiKey?: string }): LlmClient {
  const settings = config?.modelo && config?.apiKey ? null : getAiSettings();
  const modelo = config?.modelo ?? settings!.model;
  const apiKey = config?.apiKey ?? settings!.apiKey;

  return {
    nome: `openai:${modelo}`,
    async completar({ sistema, usuario }) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const resposta = await client.chat.completions.create({
        model: modelo,
        temperature: 0,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      });
      return resposta.choices[0]?.message?.content ?? "";
    },
  };
}
