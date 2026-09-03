/**
 * Orquestração do chat de IA.
 *
 * O caminho de uma mensagem é sempre o mesmo:
 *
 *   frase da pessoa
 *     (ou imagem -> modelo de visão -> texto)
 *     (ou áudio  -> modelo de fala  -> texto)
 *     -> modelo (Groq)          devolve INTENÇÃO em JSON
 *     -> parseIntent            recusa o que não bater com o contrato
 *     -> consulta               o banco responde, e o código escreve a frase
 *        ou rascunho            proposta editável, que ainda não é lançamento
 *
 * O que este módulo *não* faz é gravar. Nem no caminho de registro: ele monta
 * o rascunho e devolve. Quem grava é a tela, depois da confirmação, pelo mesmo
 * `upsertRows` que o formulário manual usa — com as mesmas checagens de
 * permissão e a mesma exigência de categoria. É a regra central deste recurso:
 * a IA propõe, a pessoa confirma, o código grava.
 */
import { queryOne } from "../../postgres/client.server";
import { requireProfileAccess } from "../../postgres/access.server";
import { getChatSettings } from "../../postgres/config.server";
import {
  ChatContractError,
  parseIntent,
  resolveData,
  resumoConsulta,
  type ChatIntent,
  type ChatReply,
  type LancamentoIntent,
  type OrigemMidia,
  type RascunhoLancamento,
} from "@/lib/chat-contract";
import { toISODate } from "@/lib/format";

import { casarCategoria, type CategoriaRef } from "./categorias";
import { validarMidia } from "./midia.server";
import { executarConsulta, listarCategoriasRef } from "./consulta.server";
import {
  ChatProviderError,
  completarChat,
  transcreverAudio,
  transcreverImagem,
  type ChatMessage,
} from "./groq.server";
import { buildChatSystemPrompt, buildTranscricaoImagemPrompt } from "./prompt";

/** Uma mensagem anterior da conversa, como a tela a guarda. */
export type HistoricoItem = { role: "user" | "assistant"; content: string };

/** Teto da frase aceita. Acima disso não é mais uma instrução de chat. */
export const MAX_MENSAGEM = 1000;

/** Arquivo que a tela anexou, já em base64 (o mesmo formato da importação). */
export type MidiaEntrada = { nome: string; mime: string; base64: string };

export async function responderChat(
  userId: string,
  input: {
    profileId: string;
    mensagem: string;
    historico: HistoricoItem[];
    imagem?: MidiaEntrada;
    audio?: MidiaEntrada;
  },
): Promise<ChatReply> {
  await requireProfileAccess(userId, input.profileId, "viewer");

  const settings = getChatSettings();

  const hoje = toISODate(new Date());

  /*
   * Etapa de mídia: imagem e áudio viram texto ANTES de qualquer interpretação.
   *
   * O resto desta função não sabe que houve um anexo — recebe uma frase, como
   * sempre. É o que mantém uma regra só no sistema: trocar o modelo de visão ou
   * o de fala não toca em nada do contrato.
   */
  const { mensagem, origem } = await extrairDaMidia(userId, input, hoje);
  const categorias = await listarCategoriasRef(input.profileId);
  const perfil = await queryOne<{ name: string }>(
    `SELECT name FROM budget_profiles WHERE id = $1`,
    [input.profileId],
  );

  const sistema = buildChatSystemPrompt({
    categorias: categorias
      .filter((categoria) => categoria.archived_at === null)
      .map((categoria) => ({
        name: categoria.name,
        kind: categoria.kind,
        description: categoria.description,
      })),
    hoje,
    perfil: perfil?.name ?? "Pessoal",
  });

  const messages: ChatMessage[] = [
    { role: "system", content: sistema },
    // As últimas trocas dão sentido a "e em transporte?" logo depois de uma
    // pergunta sobre alimentação. O teto é baixo de propósito: conversa longa
    // não melhora a interpretação de uma frase curta, só encarece a chamada.
    ...input.historico.slice(-settings.historyLimit).map((item) => ({
      role: item.role,
      content: item.content.slice(0, MAX_MENSAGEM),
    })),
    { role: "user", content: mensagem },
  ];

  const completion = await completarChat({ messages, userId });

  let intent: ChatIntent;
  try {
    intent = parseIntent(JSON.parse(completion.content));
  } catch (error) {
    console.error(
      `[chat-ia] usuário=${userId} ✕ resposta fora do contrato:`,
      error instanceof Error ? error.message : error,
    );
    // Vale mais dizer que não entendeu do que agir sobre um palpite: quem
    // reescreve a frase perde cinco segundos, quem registra um lançamento
    // errado perde a confiança no recurso.
    throw new ChatProviderError(
      error instanceof ChatContractError
        ? "Não consegui entender esse pedido. Tente reescrever de outro jeito."
        : "A IA devolveu uma resposta que não consegui ler. Tente de novo.",
    );
  }

  // A origem acompanha a resposta em qualquer um dos três caminhos: é o que
  // deixa a tela mostrar o que foi lido do papel junto do que foi decidido.
  const comOrigem = origem ? { origem } : {};

  if (intent.acao === "conversar") {
    return { tipo: "conversa", texto: intent.mensagem, ...comOrigem };
  }

  if (intent.acao === "consultar") {
    const consulta = await executarConsulta({
      userId,
      profileId: input.profileId,
      intent,
      hoje,
      categorias,
    });
    return { tipo: "consulta", texto: resumoConsulta(consulta), consulta, ...comOrigem };
  }

  const rascunho = montarRascunho(intent.lancamento, categorias, hoje);
  return { tipo: "rascunho", texto: textoDoRascunho(rascunho), rascunho, ...comOrigem };
}

/**
 * Imagem ou áudio -> texto, antes de qualquer interpretação.
 *
 * Devolve a frase que segue para o modelo de texto e, quando houve anexo, o
 * que foi extraído dele. Sem anexo, é a identidade: a frase digitada segue
 * intacta.
 *
 * O texto extraído entra marcado no pedido, e não colado como se a pessoa o
 * tivesse escrito. O modelo precisa saber que aquilo veio de um comprovante
 * lido por outra máquina — a diferença aparece, por exemplo, num cupom que traz
 * o CNPJ da loja e o número do caixa: escritos por uma pessoa seriam parte do
 * pedido, lidos de um papel são só o entorno do valor.
 */
async function extrairDaMidia(
  userId: string,
  input: { mensagem: string; imagem?: MidiaEntrada; audio?: MidiaEntrada },
  hoje: string,
): Promise<{ mensagem: string; origem?: OrigemMidia }> {
  const settings = getChatSettings();

  if (input.imagem) {
    validarMidia(input.imagem, "imagem", settings.maxImageMb);
    const leitura = await transcreverImagem({
      base64: input.imagem.base64,
      mime: input.imagem.mime,
      prompt: buildTranscricaoImagemPrompt(hoje),
      userId,
    });

    const pedido = input.mensagem.trim();
    return {
      mensagem: [
        "===== TEXTO LIDO DE UMA IMAGEM DE COMPROVANTE =====",
        leitura.texto,
        "===== FIM DO TEXTO LIDO =====",
        "",
        pedido ||
          "Registre o lançamento correspondente a este comprovante. " +
            "Se faltar algum dado essencial, pergunte em vez de supor.",
      ].join("\n"),
      origem: { tipo: "imagem", extraido: leitura.texto, modelo: leitura.model },
    };
  }

  if (input.audio) {
    validarMidia(input.audio, "audio", settings.maxAudioMb);

    const transcricao = await transcreverAudio({
      base64: input.audio.base64,
      mime: input.audio.mime,
      nome: input.audio.nome,
      userId,
    });

    // O áudio é a pessoa falando: a transcrição É a frase dela, e entra sem
    // marcação nenhuma. Ditar "gastei 158 no mercado" tem de dar exatamente o
    // mesmo resultado que digitar a mesma coisa.
    return {
      mensagem: input.mensagem.trim()
        ? `${transcricao.texto}\n${input.mensagem.trim()}`
        : transcricao.texto,
      origem: { tipo: "audio", extraido: transcricao.texto, modelo: transcricao.model },
    };
  }

  return { mensagem: input.mensagem };
}

/**
 * A intenção de registro vira proposta: data resolvida, categoria casada com
 * o perfil, status decidido. Nada aqui toca o banco.
 */
function montarRascunho(
  lancamento: LancamentoIntent,
  categorias: CategoriaRef[],
  hoje: string,
): RascunhoLancamento {
  const data = resolveData(lancamento.data, hoje);
  // Lançamento novo não vai para categoria arquivada, e só compara com as do
  // lado certo: "mercado" não pode virar uma categoria de receita.
  const categoria = casarCategoria(lancamento.categoria, categorias, {
    kind: lancamento.natureza,
  });

  return {
    description: lancamento.descricao,
    amount: lancamento.valor,
    kind: lancamento.natureza,
    category_id: categoria?.id ?? null,
    categoriaSugerida: categoria ? null : lancamento.categoria,
    transaction_date: data,
    /*
     * A primeira parcela vence no mesmo dia da compra, e as seguintes de mês
     * em mês — o cálculo é o mesmo `buildInstallments` do formulário manual, e
     * roda na confirmação, para acompanhar a data que a pessoa eventualmente
     * corrigir na revisão.
     */
    due_date: data,
    // Sem "já paguei" na frase, o lançamento nasce em aberto: é o combinado, e
    // dar baixa depois custa um clique, enquanto desfazer uma baixa errada
    // exige encontrar o lançamento de novo.
    status: lancamento.pago ? "paid" : "pending",
    parcelas: lancamento.parcelas && lancamento.parcelas > 1 ? lancamento.parcelas : 1,
  };
}

/**
 * A frase que acompanha o rascunho — montada aqui, e não pelo modelo.
 *
 * Ela não repete valor nem data: esses estão no cartão de revisão, que é o que
 * a pessoa confere antes de confirmar. Repeti-los em texto livre só criaria um
 * segundo lugar onde um número pode aparecer errado.
 */
function textoDoRascunho(rascunho: RascunhoLancamento): string {
  const partes = ["Confira o lançamento abaixo e confirme para registrar."];
  if (rascunho.category_id === null) {
    partes.push(
      rascunho.categoriaSugerida
        ? `Não encontrei a categoria "${rascunho.categoriaSugerida}" nesta subconta — escolha uma para continuar.`
        : "Escolha a categoria para continuar.",
    );
  }
  if (rascunho.parcelas > 1) {
    partes.push(`Vou dividir em ${rascunho.parcelas} parcelas mensais.`);
  }
  return partes.join(" ");
}
