/**
 * Contrato do chat de IA.
 *
 * Este módulo é puro — sem navegador, sem servidor — porque as duas pontas
 * dependem dele: o servidor valida a resposta do modelo aqui, e a tela mostra
 * o que ele devolveu usando estes mesmos tipos.
 *
 * A regra que organiza tudo o que vem a seguir: **o modelo devolve intenção,
 * não resultado**. Ele diz "consultar gastos de Alimentação no mês passado";
 * quem sabe que mês é esse, quanto foi gasto e qual era o teto é o código, com
 * uma consulta ao banco. Por isso o período e a data viajam como referência
 * simbólica (`mes_anterior`, `ontem`) e não como data pronta: assim uma conta
 * de calendário errada do modelo não vira um número errado na tela.
 *
 * A única exceção é o valor de um lançamento novo, que o modelo copia do que a
 * pessoa acabou de escrever ("gastei 158 no mercado"). Não há como evitar —
 * o dado nasce no texto. A mitigação é o fluxo: o lançamento vira rascunho,
 * aparece editável na tela e só chega ao banco depois de confirmado.
 */
import {
  brl,
  daysBetween,
  daysInMonthOf,
  formatDateBR,
  monthKeyOf,
  monthRange,
  monthTitle,
  parseISODate,
  shiftMonthKey,
  toISODate,
} from "./format";

/** Erro de contrato: a resposta do modelo não tem o formato combinado. */
export class ChatContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatContractError";
  }
}

// ───────────────────────────── referências de tempo ─────────────────────────

/**
 * Período pedido, ainda sem virar data.
 *
 * Consulta sem período é consulta sem resposta ("quanto gastei?" — quando?), e
 * por isso o campo é obrigatório no contrato: quando a pessoa não disser nada,
 * o modelo devolve `mes_atual`, que é o padrão combinado.
 */
export type PeriodoRef =
  | { tipo: "mes_atual" }
  | { tipo: "mes_anterior" }
  /** Mês específico, `YYYY-MM`. */
  | { tipo: "mes"; valor: string }
  /** Ano inteiro, `YYYY`. */
  | { tipo: "ano"; valor: string }
  /** Os N últimos dias, contando hoje. */
  | { tipo: "ultimos_dias"; valor: number }
  | { tipo: "intervalo"; de: string; ate: string };

/** Data de um lançamento, ainda sem virar data. */
export type DataRef =
  | { tipo: "hoje" }
  | { tipo: "ontem" }
  | { tipo: "dias_atras"; valor: number }
  /** Data explícita, `YYYY-MM-DD`. */
  | { tipo: "data"; valor: string };

export type Periodo = {
  from: string;
  to: string;
  /** Como o período é escrito na resposta ("setembro de 2026"). */
  label: string;
};

// ───────────────────────────────── intenção ─────────────────────────────────

/**
 * O que dá para perguntar.
 *
 * `gastos` e `entradas` somam um lado só; `saldo` responde os dois e a
 * diferença. "Saídas" é sinônimo de gastos e cai em `gastos` — dois nomes para
 * a mesma soma só dariam ao modelo uma escolha a mais para errar.
 */
export type Metrica = "gastos" | "entradas" | "saldo";

export const METRICAS: readonly Metrica[] = ["gastos", "entradas", "saldo"];

export type ConsultaIntent = {
  acao: "consultar";
  metrica: Metrica;
  /** Nome da categoria como a pessoa falou, ou `null` para o total do período. */
  categoria: string | null;
  periodo: PeriodoRef;
};

export type LancamentoIntent = {
  descricao: string;
  valor: number;
  natureza: "expense" | "income";
  /** Nome da categoria; o servidor é que resolve para um id do perfil. */
  categoria: string | null;
  data: DataRef;
  /** Só `true` quando a pessoa disse que já pagou. O padrão é ficar em aberto. */
  pago: boolean;
  /** `null` ou 1 é lançamento único; acima disso, compra parcelada. */
  parcelas: number | null;
};

export type RegistrarIntent = { acao: "registrar"; lancamento: LancamentoIntent };

/** Fora do escopo, ou faltou dado: o modelo responde em texto e pergunta. */
export type ConversarIntent = { acao: "conversar"; mensagem: string };

export type ChatIntent = ConsultaIntent | RegistrarIntent | ConversarIntent;

/** Teto de parcelas aceito na interpretação — o mesmo do formulário manual. */
export const MAX_PARCELAS_CHAT = 48;

// ──────────────────────────────── validação ─────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const ISO_YEAR = /^\d{4}$/;

function obj(value: unknown, campo: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatContractError(`${campo} deveria ser um objeto`);
  }
  return value as Record<string, unknown>;
}

function texto(value: unknown, campo: string, max = 300): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChatContractError(`${campo} deveria ser um texto preenchido`);
  }
  return value.trim().slice(0, max);
}

function textoOuNulo(value: unknown, campo: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return texto(value, campo);
}

function inteiro(value: unknown, campo: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new ChatContractError(`${campo} deveria ser um número`);
  }
  return Math.trunc(parsed);
}

function parsePeriodo(raw: unknown): PeriodoRef {
  const value = obj(raw, "periodo");
  const tipo = value["tipo"];
  switch (tipo) {
    case "mes_atual":
    case "mes_anterior":
      return { tipo };
    case "mes": {
      const valor = texto(value["valor"], "periodo.valor");
      if (!ISO_MONTH.test(valor)) throw new ChatContractError("periodo.valor deveria ser YYYY-MM");
      return { tipo, valor };
    }
    case "ano": {
      const valor = texto(value["valor"], "periodo.valor");
      if (!ISO_YEAR.test(valor)) throw new ChatContractError("periodo.valor deveria ser YYYY");
      return { tipo, valor };
    }
    case "ultimos_dias": {
      const valor = inteiro(value["valor"], "periodo.valor");
      // Um ano é o teto: acima disso a pergunta é sobre um período nomeado
      // ("2025"), não sobre "os últimos N dias".
      if (valor < 1 || valor > 366) {
        throw new ChatContractError("periodo.valor deveria estar entre 1 e 366 dias");
      }
      return { tipo, valor };
    }
    case "intervalo": {
      const de = texto(value["de"], "periodo.de");
      const ate = texto(value["ate"], "periodo.ate");
      if (!ISO_DATE.test(de) || !ISO_DATE.test(ate)) {
        throw new ChatContractError("periodo.de e periodo.ate deveriam ser YYYY-MM-DD");
      }
      // Invertido é engano de escrita, não pergunta impossível: ordenar aqui
      // responde o que foi perguntado em vez de devolver um intervalo vazio.
      return de <= ate ? { tipo, de, ate } : { tipo, de: ate, ate: de };
    }
    default:
      throw new ChatContractError(`periodo.tipo desconhecido: ${String(tipo)}`);
  }
}

function parseData(raw: unknown): DataRef {
  const value = obj(raw, "data");
  const tipo = value["tipo"];
  switch (tipo) {
    case "hoje":
    case "ontem":
      return { tipo };
    case "dias_atras": {
      const valor = inteiro(value["valor"], "data.valor");
      if (valor < 0 || valor > 366) {
        throw new ChatContractError("data.valor deveria estar entre 0 e 366 dias");
      }
      return { tipo, valor };
    }
    case "data": {
      const valor = texto(value["valor"], "data.valor");
      if (!ISO_DATE.test(valor)) throw new ChatContractError("data.valor deveria ser YYYY-MM-DD");
      return { tipo, valor };
    }
    default:
      throw new ChatContractError(`data.tipo desconhecido: ${String(tipo)}`);
  }
}

function parseLancamento(raw: unknown): LancamentoIntent {
  const value = obj(raw, "lancamento");

  const bruto = value["valor"];
  const valor = typeof bruto === "string" ? Number(bruto.replace(",", ".")) : bruto;
  // O sinal é ignorado, não recusado: quem diz se o dinheiro entrou ou saiu é
  // `natureza`, e um modelo que escreve -50 para uma despesa quis dizer 50. O
  // que não passa é zero — aí não há valor nenhum, e o certo é perguntar.
  if (typeof valor !== "number" || !Number.isFinite(valor) || Math.abs(valor) === 0) {
    throw new ChatContractError("lancamento.valor deveria ser um número diferente de zero");
  }

  const natureza = value["natureza"];
  if (natureza !== "expense" && natureza !== "income") {
    throw new ChatContractError("lancamento.natureza deveria ser expense ou income");
  }

  const parcelasBrutas = value["parcelas"];
  const parcelas =
    parcelasBrutas === null || parcelasBrutas === undefined
      ? null
      : inteiro(parcelasBrutas, "lancamento.parcelas");
  if (parcelas !== null && (parcelas < 1 || parcelas > MAX_PARCELAS_CHAT)) {
    throw new ChatContractError(`lancamento.parcelas deveria ir de 1 a ${MAX_PARCELAS_CHAT}`);
  }

  return {
    descricao: texto(value["descricao"], "lancamento.descricao", 120),
    // Centavos e nada mais: o resto seria ruído num campo de dinheiro.
    valor: Math.round(Math.abs(valor) * 100) / 100,
    natureza,
    categoria: textoOuNulo(value["categoria"], "lancamento.categoria"),
    data: parseData(value["data"]),
    pago: value["pago"] === true,
    parcelas,
  };
}

/**
 * Valida o JSON que voltou do modelo.
 *
 * Estrito de propósito: campo faltando ou fora do domínio vira erro, e não um
 * valor "mais ou menos". O chamador trata o erro pedindo que a pessoa
 * reescreva a frase — muito melhor do que registrar um lançamento cujo tipo o
 * servidor adivinhou.
 */
export function parseIntent(raw: unknown): ChatIntent {
  const value = obj(raw, "resposta");
  const acao = value["acao"];

  if (acao === "consultar") {
    const metrica = value["metrica"];
    if (!METRICAS.includes(metrica as Metrica)) {
      throw new ChatContractError(`metrica desconhecida: ${String(metrica)}`);
    }
    return {
      acao,
      metrica: metrica as Metrica,
      categoria: textoOuNulo(value["categoria"], "categoria"),
      periodo: parsePeriodo(value["periodo"]),
    };
  }

  if (acao === "registrar") return { acao, lancamento: parseLancamento(value["lancamento"]) };

  if (acao === "conversar") {
    return { acao, mensagem: texto(value["mensagem"], "mensagem", 600) };
  }

  throw new ChatContractError(`acao desconhecida: ${String(acao)}`);
}

// ──────────────────────────── resolução das datas ───────────────────────────

/** Soma (ou subtrai) dias de uma data ISO, sem passar por fuso. */
function shiftDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Referência simbólica -> intervalo concreto, mais o rótulo que vai na resposta. */
export function resolvePeriodo(ref: PeriodoRef, hoje: string): Periodo {
  switch (ref.tipo) {
    case "mes_atual": {
      const key = monthKeyOf(hoje);
      return { ...monthRange(key), label: monthTitle(key) };
    }
    case "mes_anterior": {
      const key = shiftMonthKey(monthKeyOf(hoje), -1);
      return { ...monthRange(key), label: monthTitle(key) };
    }
    case "mes":
      return { ...monthRange(ref.valor), label: monthTitle(ref.valor) };
    case "ano":
      return { from: `${ref.valor}-01-01`, to: `${ref.valor}-12-31`, label: ref.valor };
    case "ultimos_dias": {
      // "Os últimos 7 dias" inclui hoje: são 7 dias, não 8.
      const from = shiftDays(hoje, -(ref.valor - 1));
      return {
        from,
        to: hoje,
        label: ref.valor === 1 ? "hoje" : `os últimos ${ref.valor} dias`,
      };
    }
    case "intervalo":
      return {
        from: ref.de,
        to: ref.ate,
        label: `${formatDateBR(ref.de)} a ${formatDateBR(ref.ate)}`,
      };
  }
}

/** Referência simbólica -> data ISO do lançamento. */
export function resolveData(ref: DataRef, hoje: string): string {
  switch (ref.tipo) {
    case "hoje":
      return hoje;
    case "ontem":
      return shiftDays(hoje, -1);
    case "dias_atras":
      return shiftDays(hoje, -ref.valor);
    case "data":
      return ref.valor;
  }
}

// ─────────────────────────── resultado da consulta ──────────────────────────

export type ConsultaCategoria = {
  id: string | null;
  name: string;
  color: string;
  total: number;
};

/**
 * O que a consulta encontrou. Todos os números aqui saíram de um SUM no banco:
 * nenhum deles passou pelo modelo.
 */
export type ConsultaResult = {
  metrica: Metrica;
  periodo: Periodo;
  /** A categoria pedida, quando existe no perfil. */
  categoria: { id: string; name: string; color: string; monthlyCap: number | null } | null;
  /** O nome que a pessoa pediu, preenchido só quando nenhuma categoria casou. */
  categoriaNaoEncontrada: string | null;
  entradas: number;
  saidas: number;
  saldo: number;
  lancamentos: number;
  /**
   * Teto da categoria rateado pelos dias do período — o mesmo cálculo dos
   * cartões de orçamento do painel, para os dois números baterem.
   */
  teto: number | null;
  /** Quebra por categoria do lado consultado; vazia quando a pergunta fixou uma. */
  porCategoria: ConsultaCategoria[];
};

/** Teto mensal rateado pelos dias do período consultado. */
export function tetoDoPeriodo(monthlyCap: number | null, periodo: Periodo): number | null {
  if (monthlyCap === null || !(monthlyCap > 0)) return null;
  const dias = daysBetween(periodo.from, periodo.to);
  return (monthlyCap / daysInMonthOf(periodo.from)) * dias;
}

/**
 * A frase da resposta, montada aqui e não pelo modelo.
 *
 * Parece detalhe de apresentação, mas é a mesma regra do resto do arquivo: a
 * frase carrega números, e número que o modelo escreve é número que ele pode
 * escrever errado. Aqui ela é função dos totais que vieram do banco.
 */
export function resumoConsulta(resultado: ConsultaResult): string {
  const { periodo, categoria, teto } = resultado;
  const partes: string[] = [];

  if (resultado.categoriaNaoEncontrada) {
    partes.push(
      `Não encontrei a categoria "${resultado.categoriaNaoEncontrada}" nesta subconta, ` +
        `então respondi com o total do período.`,
    );
  }

  const onde = categoria ? ` em ${categoria.name}` : "";

  if (resultado.metrica === "saldo") {
    partes.push(
      `Em ${periodo.label} entraram ${brl(resultado.entradas)} e saíram ` +
        `${brl(resultado.saidas)} — saldo de ${brl(resultado.saldo)}.`,
    );
  } else if (resultado.metrica === "entradas") {
    partes.push(`Você recebeu ${brl(resultado.entradas)}${onde} em ${periodo.label}.`);
  } else if (teto !== null) {
    const sobra = teto - resultado.saidas;
    partes.push(
      `Você gastou ${brl(resultado.saidas)} do seu teto de ${brl(teto)}${onde}, em ${periodo.label}.`,
    );
    partes.push(
      sobra >= 0
        ? `Ainda cabem ${brl(sobra)} no período.`
        : `Está ${brl(Math.abs(sobra))} acima do teto.`,
    );
  } else {
    partes.push(`Você gastou ${brl(resultado.saidas)}${onde} em ${periodo.label}.`);
  }

  if (resultado.lancamentos === 0) {
    partes.push("Não há nenhum lançamento nesse período.");
  }

  return partes.join(" ");
}

// ───────────────────────────── rascunho e resposta ──────────────────────────

/**
 * O lançamento proposto, já com data resolvida e categoria casada com o
 * perfil. Ainda não está no banco: é o que a tela mostra para revisão.
 */
export type RascunhoLancamento = {
  description: string;
  amount: number;
  kind: "income" | "expense";
  category_id: string | null;
  /** Nome sugerido pelo modelo quando nenhuma categoria do perfil casou. */
  categoriaSugerida: string | null;
  transaction_date: string;
  due_date: string;
  status: "paid" | "pending";
  /** 1 é lançamento único. */
  parcelas: number;
};

/**
 * De onde veio a mensagem, quando não foi digitada.
 *
 * Uma imagem ou um áudio passam por uma etapa a mais — transcrição — antes de
 * o pedido virar intenção. `extraido` é o texto que saiu dessa etapa, e a tela
 * o mostra discretamente junto da resposta.
 *
 * Isso não é enfeite: é a única forma de a pessoa conferir *o que o sistema
 * entendeu do papel* quando o lançamento sair estranho. Sem esse texto à vista,
 * um valor lido errado no cupom é indistinguível de um valor interpretado
 * errado na frase, e não há como saber em qual das duas etapas corrigir.
 */
export type OrigemMidia = {
  tipo: "imagem" | "audio";
  /** O texto lido da imagem, ou a transcrição do áudio. */
  extraido: string;
  /** Modelo que fez a extração — o log diz de onde o texto veio. */
  modelo: string;
};

type ChatRespostaBase =
  | { tipo: "consulta"; texto: string; consulta: ConsultaResult }
  | { tipo: "rascunho"; texto: string; rascunho: RascunhoLancamento }
  | { tipo: "conversa"; texto: string };

export type ChatReply = ChatRespostaBase & {
  /** Preenchido só quando a mensagem nasceu de uma imagem ou de um áudio. */
  origem?: OrigemMidia;
};
