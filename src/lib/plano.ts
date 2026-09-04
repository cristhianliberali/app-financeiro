/**
 * Vocabulário do plano e a regra que libera o app.
 *
 * Este arquivo é puro e roda nos dois lados: o servidor decide o acesso de
 * verdade (nas server functions), e a tela usa a mesma função para não mostrar
 * um botão que o servidor vai recusar. Duas implementações da mesma regra é
 * como se chega numa tela que promete o que o back nega.
 *
 * Nada aqui fala com a Cakto. A tradução de evento de webhook para um destes
 * status vive em `src/integrations/cakto/contrato.ts`, e é a única parte que
 * precisa mudar se a Cakto renomear um evento.
 */

export const STATUS_PLANO = [
  "ativo",
  "trial",
  "cortesia",
  "atrasado",
  "pausado",
  "cancelado",
  "reembolsado",
  "chargeback",
  "sem_assinatura",
] as const;

export type StatusPlano = (typeof STATUS_PLANO)[number];

export const ORIGEM_PLANO = ["cakto", "admin", "cadastro"] as const;
export type OrigemPlano = (typeof ORIGEM_PLANO)[number];

/** Status de quem acabou de se cadastrar e ainda não comprou nada. */
export const STATUS_PADRAO: StatusPlano = "sem_assinatura";

/**
 * Os status que dão acesso sem ressalva.
 *
 * `atrasado` não está aqui, mas também não bloqueia na hora: ele tem uma janela
 * própria, logo abaixo. Os demais encerram o acesso imediatamente.
 */
const STATUS_LIBERADOS: readonly StatusPlano[] = ["ativo", "trial", "cortesia"];

/**
 * Janela de carência da inadimplência, em dias.
 *
 * Uma renovação recusada não é o fim da assinatura: a Cakto tenta de novo. Os
 * webhooks reais trazem a política dela no próprio corpo — `max_retries: 3` com
 * `retry_interval: 1` —, ou seja, três tentativas em três dias. Cortar o acesso
 * no instante da primeira recusa tiraria o app de quem vai pagar no dia
 * seguinte, e ainda geraria o suporte que essa retentativa existe para evitar.
 *
 * A janela conta a partir de quando a recusa chegou (`atualizadoEm`), não do
 * fim do período pago: `next_payment_date` nos eventos de recusa aponta a
 * próxima *tentativa*, e não uma data até a qual a pessoa pagou.
 */
const DIAS_CARENCIA_PADRAO = 3;

export function isStatusPlano(value: unknown): value is StatusPlano {
  return typeof value === "string" && (STATUS_PLANO as readonly string[]).includes(value);
}

export function normalizarStatus(value: unknown): StatusPlano {
  return isStatusPlano(value) ? value : STATUS_PADRAO;
}

export type EstadoPlano = {
  status: StatusPlano;
  /** Fim do acesso já pago. Nulo = sem prazo (cortesia vitalícia, por exemplo). */
  expiraEm?: Date | string | null;
  /** Quando o status atual foi gravado. Base da carência de `atrasado`. */
  atualizadoEm?: Date | string | null;
  codigoOferta?: string | null;
};

export type MotivoBloqueio =
  "sem_assinatura" | "vencido" | "inadimplente" | "pausado" | "encerrado";

export type AvaliacaoPlano = {
  liberado: boolean;
  status: StatusPlano;
  motivo: MotivoBloqueio | null;
  /** Dias inteiros até `expiraEm`; nulo quando não há prazo. */
  diasRestantes: number | null;
};

const DIA_MS = 24 * 60 * 60 * 1000;

function paraData(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type OpcoesAvaliacao = {
  agora?: Date;
  /** Folga depois de `expiraEm`, para a demora do webhook de renovação. */
  toleranciaDias?: number;
  /** Janela de carência de `atrasado`, contada a partir de `atualizadoEm`. */
  diasCarencia?: number;
};

/**
 * Avalia o acesso de uma pessoa.
 *
 * Dois relógios diferentes, por dois motivos diferentes:
 *
 *   - `toleranciaDias` é a folga depois de `expiraEm`. Cobre o intervalo entre
 *     a renovação acontecer na Cakto e o webhook dela chegar aqui. Sem essa
 *     folga, todo assinante em dia perderia o app por algumas horas a cada
 *     ciclo de cobrança;
 *   - `diasCarencia` é a folga depois de uma recusa de pagamento. Cobre as
 *     retentativas da Cakto, que são três, uma por dia.
 *
 * A ordem importa: um status encerrado (cancelado, reembolsado, chargeback,
 * pausado) bloqueia na hora, independentemente de qualquer data. Prazo só
 * encurta acesso — nunca ressuscita uma assinatura que acabou.
 */
export function avaliarPlano(plano: EstadoPlano, opcoes: OpcoesAvaliacao = {}): AvaliacaoPlano {
  const agora = opcoes.agora ?? new Date();
  const tolerancia = Math.max(0, opcoes.toleranciaDias ?? 0);
  const carencia = Math.max(0, opcoes.diasCarencia ?? DIAS_CARENCIA_PADRAO);
  const status = normalizarStatus(plano.status);
  const expiraEm = paraData(plano.expiraEm);

  const diasRestantes = expiraEm
    ? Math.ceil((expiraEm.getTime() - agora.getTime()) / DIA_MS)
    : null;

  // Inadimplência tem regra própria: vale enquanto a Cakto ainda tenta cobrar.
  if (status === "atrasado") {
    const desde = paraData(plano.atualizadoEm);
    const dentroDaCarencia = !!desde && desde.getTime() + carencia * DIA_MS > agora.getTime();
    return {
      liberado: dentroDaCarencia,
      status,
      motivo: dentroDaCarencia ? null : "inadimplente",
      diasRestantes,
    };
  }

  if (!STATUS_LIBERADOS.includes(status)) {
    return { liberado: false, status, motivo: motivoDoStatus(status), diasRestantes };
  }

  if (expiraEm && expiraEm.getTime() + tolerancia * DIA_MS <= agora.getTime()) {
    return { liberado: false, status, motivo: "vencido", diasRestantes };
  }

  return { liberado: true, status, motivo: null, diasRestantes };
}

function motivoDoStatus(status: StatusPlano): MotivoBloqueio {
  if (status === "sem_assinatura") return "sem_assinatura";
  if (status === "atrasado") return "inadimplente";
  if (status === "pausado") return "pausado";
  return "encerrado";
}

/** Atalho para quando só interessa o sim ou não. */
export function planoLiberado(plano: EstadoPlano, opcoes: OpcoesAvaliacao = {}): boolean {
  return avaliarPlano(plano, opcoes).liberado;
}

export const ROTULO_STATUS: Record<StatusPlano, string> = {
  ativo: "Ativo",
  trial: "Em teste",
  cortesia: "Cortesia",
  atrasado: "Pagamento atrasado",
  pausado: "Pausada",
  cancelado: "Cancelado",
  reembolsado: "Reembolsado",
  chargeback: "Chargeback",
  sem_assinatura: "Sem assinatura",
};

export const ROTULO_ORIGEM: Record<OrigemPlano, string> = {
  cakto: "Cakto",
  admin: "Ajuste manual",
  cadastro: "Cadastro",
};

/**
 * A frase que a pessoa bloqueada lê. Cada motivo pede uma saída diferente —
 * quem nunca assinou precisa de um link de compra, quem está com o cartão
 * recusado precisa saber que é só atualizar o meio de pagamento.
 */
export const MENSAGEM_BLOQUEIO: Record<MotivoBloqueio, string> = {
  sem_assinatura: "Escolha um plano para começar a usar o app.",
  vencido: "Sua assinatura chegou ao fim do período pago. Renove para voltar a usar o app.",
  inadimplente:
    "O último pagamento não foi aprovado e as novas tentativas também falharam. Atualize a forma " +
    "de pagamento para recuperar o acesso — seus dados continuam aqui, intactos.",
  pausado:
    "Sua assinatura está pausada. Retome-a para voltar a usar o app — " +
    "seus dados continuam aqui, intactos.",
  encerrado:
    "Sua assinatura foi encerrada. Assine novamente para voltar a usar o app — " +
    "seus dados continuam aqui, intactos.",
};
