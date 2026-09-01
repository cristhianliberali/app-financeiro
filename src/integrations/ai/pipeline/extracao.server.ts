/**
 * Extração determinística para a tela — a primeira das duas etapas da
 * importação.
 *
 * Nenhuma requisição de IA acontece aqui. O arquivo passa pelas camadas 1
 * (ingestão), 2 (tipagem) e 4 (reconciliação), e o que sai é tudo o que a tela
 * precisa mostrar de uma vez: as transações encontradas, a conferência dos
 * totais que o próprio documento declara, e as linhas que ficaram sem leitura.
 *
 * A IA entra só na segunda etapa, quando o usuário pedir a categorização — e
 * mesmo então ela recebe linhas numeradas e devolve decisões, nunca o arquivo.
 */
import { extractText as converterLegado, MAX_FILE_BYTES } from "../extract.server";
import { canonizar, type OrigemLinha } from "./canonical.server";
import { reconciliar, type ViaDeFechamento } from "./reconcile";
import {
  lancamentos,
  tipar,
  TipoLinha,
  usaMarcadorDC,
  type ConvencaoNumerica,
  type Parcela,
} from "./typing";

export type ArquivoEnviado = {
  name: string;
  /** Conteúdo em base64, sem o prefixo `data:`. */
  base64: string;
};

export type TransacaoExtraida = {
  /** Id da linha no documento canônico — é ele que a etapa de IA vai referenciar. */
  linhaId: number;
  descricao: string;
  /** Valor absoluto; o sentido vai em `kind` e `estorno`. */
  valor: number;
  kind: "income" | "expense";
  estorno: boolean;
  dataIso: string | null;
  /** A data como está escrita no documento, para conferência. */
  dataRaw: string | null;
  parcela: Parcela | null;
  /** Rótulo do bloco a que a linha pertence — portador, conta, seção. */
  grupo: string | null;
  /** `orfao` (não soma em nenhum total) e `sanidade` (validador apontou). */
  avisos: ReadonlyArray<"orfao" | "sanidade">;
};

export type TotalConferido = {
  linhaId: number;
  rotulo: string;
  valor: number;
  fechou: boolean;
  via: ViaDeFechamento | null;
  /** Declarado menos encontrado; é o tamanho do buraco quando não fechou. */
  diferenca: number;
  /**
   * Entra no veredito da conferência. Limite, taxa, mínimo e projeção ficam
   * `false`: são declarados pelo documento, mas não são soma das linhas.
   */
  conferivel: boolean;
};

export type ConferenciaExtracao = {
  /** `false` quando o documento não declara nenhum total conferível. */
  disponivel: boolean;
  fechouTudo: boolean;
  totais: TotalConferido[];
  alertas: Array<{ mensagem: string; linhas: number[] }>;
};

export type ExtracaoParaTela = {
  origem: OrigemLinha;
  convencao: ConvencaoNumerica;
  /** Vencimento declarado no documento; sem rótulo, o fim do período. */
  vencimento: string | null;
  periodo: { inicio: string | null; fim: string | null };
  transacoes: TransacaoExtraida[];
  conferencia: ConferenciaExtracao;
  /** Linhas que nenhuma regra resolveu. Aparecem na tela, nunca somem. */
  naoInterpretadas: Array<{ linhaId: number; texto: string }>;
  estatisticas: { linhas: number; paginas: number };
};

/** Formatos que ainda passam pelo conversor de texto antigo antes da camada 1. */
const CONVERSAO_LEGADA = new Set(["docx", "doc", "xlsx", "xlsm", "xls"]);

function bytesDe(input: { text?: string; file?: ArquivoEnviado }): {
  nome: string;
  bytes: Uint8Array;
} {
  if (input.file) {
    const bytes = Buffer.from(input.file.base64, "base64");
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(
        `Arquivo de ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB excede o limite de ` +
          `${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      );
    }
    return { nome: input.file.name, bytes: new Uint8Array(bytes) };
  }

  const texto = (input.text ?? "").trim();
  if (texto.length < 10) throw new Error("Não há texto suficiente para analisar.");
  return { nome: "texto colado", bytes: new TextEncoder().encode(texto) };
}

/**
 * Sentido do valor, sem adivinhação de semântica além do que o documento
 * garante.
 *
 * Em extrato o sinal é do banco — débito é gasto, crédito é entrada. É o caso
 * do OFX (`TRNAMT` negativo) e do PDF que marca os valores com letra
 * ("1.234,56 D"). Nos demais vale a convenção de fatura: positivo é gasto, e o
 * negativo é estorno ou crédito. A tela deixa corrigir o que fugir disso.
 */
function sentidoDe(valor: number, semanticaBancaria: boolean): "income" | "expense" {
  if (semanticaBancaria) return valor < 0 ? "expense" : "income";
  return valor < 0 ? "income" : "expense";
}

/**
 * Roda as camadas determinísticas e devolve o pacote da tela.
 *
 * `hoje` é injetável para os testes não dependerem do relógio — em produção o
 * padrão é a data corrente, usada só quando o documento não traz data completa.
 */
export async function extrairParaTela(
  input: { text?: string; file?: ArquivoEnviado },
  opcoes: { hoje?: Date } = {},
): Promise<ExtracaoParaTela> {
  const { nome, bytes } = bytesDe(input);

  // Word e planilha ainda não têm adaptador canônico próprio: viram texto pelo
  // conversor da importação antiga e entram na camada 1 como texto colado.
  const extensao = nome.split(".").pop()?.toLowerCase() ?? "";
  const entrada = CONVERSAO_LEGADA.has(extensao)
    ? {
        nome,
        bytes: new TextEncoder().encode(
          (await converterLegado({ name: nome, base64: Buffer.from(bytes).toString("base64") }))
            .text,
        ),
      }
    : { nome, bytes };

  const canonico = await canonizar(entrada);
  const tipado = tipar(canonico, opcoes.hoje ? { hoje: opcoes.hoje } : {});
  const relatorio = reconciliar(tipado);

  const porId = new Map(tipado.linhas.map((linha) => [linha.id, linha]));
  const rotuloDoGrupo = (grupo: number | null): string | null =>
    grupo === null ? null : (porId.get(grupo)?.texto.trim() ?? null);

  // Extrato tem semântica de banco; fatura, de fatura. E extrato não anuncia
  // estorno: todo crédito ali é só crédito, então a marca fica de fora.
  const semanticaBancaria = canonico.origem === "ofx" || usaMarcadorDC(tipado);

  const temTotais = relatorio.totais.some((fechamento) => fechamento.total.conferivel);
  // "Fora dos totais" só é sinal quando o documento enumera as linhas em
  // subtotais por bloco e sobra pouca coisa. Quando a maioria ficaria órfã, o
  // documento simplesmente não fecha por blocos — aí o aviso linha a linha é
  // ruído, e quem fala é o veredito da conferência.
  const todosOrfaos = new Set(temTotais ? relatorio.orfaos : []);
  const quantosLancamentos = lancamentos(tipado).length;
  const orfaos = todosOrfaos.size <= quantosLancamentos * 0.3 ? todosOrfaos : new Set<number>();
  const comSanidade = new Set(relatorio.alertas.flatMap((alerta) => alerta.linhas));

  const transacoes: TransacaoExtraida[] = [];
  const naoInterpretadas: Array<{ linhaId: number; texto: string }> = [];

  for (const linha of lancamentos(tipado)) {
    if (linha.valor === null || linha.descricao === null) {
      naoInterpretadas.push({ linhaId: linha.id, texto: linha.texto });
      continue;
    }
    transacoes.push({
      linhaId: linha.id,
      descricao: linha.descricao,
      valor: Math.abs(linha.valor),
      kind: sentidoDe(linha.valor, semanticaBancaria),
      estorno: semanticaBancaria ? false : linha.estorno,
      dataIso: linha.dataIso,
      dataRaw: linha.dataRaw,
      parcela: linha.parcela,
      grupo: rotuloDoGrupo(linha.grupo),
      avisos: [
        ...(orfaos.has(linha.id) ? (["orfao"] as const) : []),
        ...(comSanidade.has(linha.id) ? (["sanidade"] as const) : []),
      ],
    });
  }

  for (const linha of tipado.linhas) {
    if (linha.tipo === TipoLinha.AMBIGUA && linha.texto.trim() !== "") {
      naoInterpretadas.push({ linhaId: linha.id, texto: linha.texto });
    }
  }
  naoInterpretadas.sort((a, b) => a.linhaId - b.linhaId);

  return {
    origem: canonico.origem,
    convencao: tipado.convencao,
    vencimento: tipado.periodo.vencimento ?? tipado.periodo.fim,
    periodo: { inicio: tipado.periodo.inicio, fim: tipado.periodo.fim },
    transacoes,
    conferencia: {
      disponivel: temTotais,
      fechouTudo: temTotais && relatorio.fechouTudo,
      totais: relatorio.totais.map((fechamento) => ({
        linhaId: fechamento.total.id,
        rotulo: fechamento.total.rotulo,
        valor: fechamento.total.valor,
        fechou: fechamento.fechou,
        via: fechamento.via,
        diferenca: fechamento.diferenca,
        conferivel: fechamento.total.conferivel,
      })),
      alertas: relatorio.alertas.map((alerta) => ({
        mensagem: alerta.mensagem,
        linhas: [...alerta.linhas],
      })),
    },
    naoInterpretadas,
    estatisticas: { linhas: canonico.linhas.length, paginas: canonico.metadados.nPaginas },
  };
}
