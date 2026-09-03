/**
 * Tradução do webhook da Cakto para o vocabulário do app.
 *
 * Regra arquitetural deste módulo: **a Cakto decide o estado da assinatura; o
 * app decide o que esse estado libera**. Aqui só acontece a tradução de um para
 * o outro. Nenhuma consulta ao banco, nenhuma chamada de rede, nada de sessão —
 * é uma função pura, e é por isso que ela é a única parte da integração
 * inteiramente coberta por teste sem precisar de uma conta na Cakto.
 *
 * O módulo é escrito para ser *tolerante de propósito*. O corpo do webhook é
 * documentado, mas documentação de gateway envelhece: um campo vira camelCase,
 * um evento novo aparece, um plano de assinatura manda `subscription.id` onde o
 * pagamento avulso manda `id`. Em vez de exigir um formato exato e explodir na
 * primeira divergência, cada dado é procurado numa lista de caminhos plausíveis,
 * e o corpo cru é sempre guardado em `cakto_webhook_events` — se a leitura
 * estiver errada, dá para corrigir o mapa e reprocessar o evento guardado, sem
 * pedir reenvio a ninguém.
 *
 * O que NÃO é tolerante: a autenticação do webhook (`conferirSegredo`) e a
 * decisão de liberar acesso. Não adivinhar é o ponto ali.
 */
import { normalizarStatus, type StatusPlano } from "@/lib/plano";

/** O que o app entende de um webhook, depois de traduzido. */
export type EventoCakto = {
  /** Nome do evento já normalizado (minúsculo, com underscore). */
  evento: string;
  /** Identificador do evento/pedido do lado da Cakto. Chave de idempotência. */
  eventoExterno: string | null;
  email: string | null;
  nome: string | null;
  codigoOferta: string | null;
  nomeOferta: string | null;
  assinaturaId: string | null;
  clienteId: string | null;
  /** Status que este evento impõe, ou `null` quando o evento não decide nada. */
  status: StatusPlano | null;
  /** Fim do período pago, quando o corpo diz. */
  expiraEm: Date | null;
  /** Status cru da Cakto, guardado para diagnóstico. */
  statusCakto: string | null;
};

/**
 * Evento da Cakto -> status do app.
 *
 * Os nomes à esquerda são os eventos documentados (compra aprovada, compra
 * recusada, reembolso, chargeback, assinatura criada, renovada e cancelada),
 * mais as variações de grafia que o mesmo evento costuma assumir entre versões
 * de uma API. Um nome desconhecido não é erro: cai no mapa de status abaixo, e
 * se nem ali houver resposta o evento é guardado como `ignorado`, para alguém
 * olhar — nunca chutado.
 */
const EVENTO_PARA_STATUS: Record<string, StatusPlano> = {
  // Compra aprovada / assinatura ativa
  purchase_approved: "ativo",
  purchase_approved_recurring: "ativo",
  compra_aprovada: "ativo",
  subscription_created: "ativo",
  subscription_renewed: "ativo",
  subscription_renewal: "ativo",
  subscription_reactivated: "ativo",
  assinatura_criada: "ativo",
  assinatura_renovada: "ativo",

  // Período de teste
  subscription_trial: "trial",
  trial_started: "trial",

  // Pagamento que não entrou
  purchase_refused: "atrasado",
  purchase_declined: "atrasado",
  compra_recusada: "atrasado",
  payment_failed: "atrasado",
  subscription_payment_failed: "atrasado",
  subscription_late: "atrasado",

  // Fim da relação
  subscription_canceled: "cancelado",
  subscription_cancelled: "cancelado",
  subscription_expired: "cancelado",
  assinatura_cancelada: "cancelado",
  refund: "reembolsado",
  refunded: "reembolsado",
  purchase_refunded: "reembolsado",
  reembolso: "reembolsado",
  chargeback: "chargeback",
  purchase_chargeback: "chargeback",
};

/**
 * Rede de segurança: o campo `status` do próprio pedido.
 *
 * Vale quando o nome do evento é desconhecido — um evento novo que a Cakto
 * passe a mandar tende a trazer um `status` que já conhecemos, e é melhor
 * acertar por aí do que ignorar a mudança e deixar alguém pagando sem acesso.
 */
const STATUS_CAKTO_PARA_STATUS: Record<string, StatusPlano> = {
  paid: "ativo",
  approved: "ativo",
  active: "ativo",
  aprovado: "ativo",
  pago: "ativo",
  trialing: "trial",
  trial: "trial",
  refused: "atrasado",
  declined: "atrasado",
  failed: "atrasado",
  overdue: "atrasado",
  late: "atrasado",
  recusado: "atrasado",
  waiting_payment: "atrasado",
  canceled: "cancelado",
  cancelled: "cancelado",
  expired: "cancelado",
  cancelado: "cancelado",
  refunded: "reembolsado",
  reembolsado: "reembolsado",
  chargeback: "chargeback",
};

/** Eventos que reconhecemos e que, de propósito, não mexem no acesso. */
const EVENTOS_SEM_EFEITO = new Set([
  "pix_generated",
  "boleto_generated",
  "purchase_created",
  "checkout_abandoned",
  "carrinho_abandonado",
]);

/**
 * Normaliza um nome vindo de fora: acentos fora, separadores em underscore.
 * "Assinatura Renovada", "subscription-renewed" e "subscriptionRenewed" viram
 * a mesma chave.
 */
export function normalizarNomeEvento(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type Json = Record<string, unknown>;

function isObjeto(valor: unknown): valor is Json {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Lê `a.b.c` num objeto desconhecido, sem estourar no meio do caminho. */
function noCaminho(raiz: unknown, caminho: string): unknown {
  let atual: unknown = raiz;
  for (const parte of caminho.split(".")) {
    if (!isObjeto(atual)) return undefined;
    atual = atual[parte];
  }
  return atual;
}

/** Primeiro caminho que devolve um texto não vazio. */
function texto(raiz: unknown, ...caminhos: string[]): string | null {
  for (const caminho of caminhos) {
    const valor = noCaminho(raiz, caminho);
    if (typeof valor === "string" && valor.trim()) return valor.trim();
    if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  }
  return null;
}

/** Primeiro caminho que devolve uma data válida. */
function data(raiz: unknown, ...caminhos: string[]): Date | null {
  for (const caminho of caminhos) {
    const valor = noCaminho(raiz, caminho);
    if (typeof valor !== "string" && typeof valor !== "number") continue;
    const date = new Date(valor);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/**
 * Traduz o corpo do webhook.
 *
 * Devolve `null` só quando não há nem nome de evento — aí não há o que
 * interpretar. Evento conhecido sem efeito, ou desconhecido, volta com
 * `status: null`: quem chama grava o evento e não mexe em ninguém.
 */
export function interpretarWebhook(corpo: unknown): EventoCakto | null {
  const evento = normalizarNomeEvento(
    noCaminho(corpo, "event") ?? noCaminho(corpo, "evento") ?? noCaminho(corpo, "type"),
  );
  if (!evento) return null;

  // O corpo documentado embrulha tudo em `data`; alguns gateways mandam os
  // campos na raiz. Procurar nos dois cobre as duas formas sem ramificação.
  const dados = isObjeto(noCaminho(corpo, "data")) ? noCaminho(corpo, "data") : corpo;

  const statusCakto = texto(dados, "status", "subscription.status", "order.status");
  const status = resolverStatus(evento, statusCakto);

  return {
    evento,
    eventoExterno: texto(dados, "id", "refId", "ref_id", "order.id", "transaction.id"),
    email: normalizarEmail(
      texto(
        dados,
        "customer.email",
        "customer_email",
        "customerEmail",
        "cliente.email",
        "buyer.email",
        "email",
      ),
    ),
    nome: texto(dados, "customer.name", "customer_name", "cliente.nome", "buyer.name", "name"),
    codigoOferta: texto(
      dados,
      "offer.id",
      "offer_id",
      "offerId",
      "offer.short_id",
      "oferta.id",
      "subscription.offer.id",
      "subscription.offer_id",
    ),
    nomeOferta: texto(dados, "offer.name", "offer_name", "oferta.nome", "product.name"),
    assinaturaId: texto(
      dados,
      "subscription.id",
      "subscription_id",
      "subscriptionId",
      "assinatura.id",
      // Numa assinatura sem objeto próprio, o pedido-pai é o fio que liga as
      // renovações à compra original.
      "parent_order.id",
      "parentOrder.id",
    ),
    clienteId: texto(dados, "customer.id", "customer_id", "customerId", "cliente.id"),
    status,
    expiraEm: data(
      dados,
      "subscription.next_payment_date",
      "subscription.nextPaymentDate",
      "subscription.next_charge_date",
      "subscription.expires_at",
      "subscription.expiresAt",
      "next_payment_date",
      "nextPaymentDate",
      "next_charge_date",
      "expires_at",
      "expiresAt",
      "data_proxima_cobranca",
    ),
    statusCakto,
  };
}

function resolverStatus(evento: string, statusCakto: string | null): StatusPlano | null {
  const porEvento = EVENTO_PARA_STATUS[evento];
  if (porEvento) return porEvento;
  if (EVENTOS_SEM_EFEITO.has(evento)) return null;

  const chave = normalizarNomeEvento(statusCakto);
  return STATUS_CAKTO_PARA_STATUS[chave] ?? null;
}

function normalizarEmail(valor: string | null): string | null {
  if (!valor) return null;
  const email = valor.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** Nomes de evento que sabemos traduzir — usado na tela do super admin. */
export function eventosConhecidos(): string[] {
  return Object.keys(EVENTO_PARA_STATUS).sort();
}

/**
 * Confere o segredo do webhook em tempo constante.
 *
 * A Cakto manda o segredo configurado no painel dentro do próprio corpo
 * (`secret`); aceitamos também por cabeçalho, que é onde alguns painéis o
 * colocam. Sem segredo configurado no app, a rota recusa tudo: um endpoint que
 * muda o acesso de qualquer pessoa não pode ficar aberto, e não existe padrão
 * razoável para inventar aqui.
 *
 * A comparação não usa `timingSafeEqual` do Node porque este arquivo também é
 * lido pelo bundle do cliente; o laço abaixo tem o mesmo efeito — percorre
 * sempre o comprimento inteiro, sem sair no primeiro caractere diferente.
 */
export function conferirSegredo(recebido: unknown, esperado: string | undefined): boolean {
  if (!esperado) return false;
  if (typeof recebido !== "string" || !recebido) return false;

  const a = recebido;
  const b = esperado;
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diferenca |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  }
  return diferenca === 0;
}

/** Onde o segredo pode estar no corpo do webhook. */
export function segredoDoCorpo(corpo: unknown): string | null {
  return texto(corpo, "secret", "segredo", "data.secret", "webhook_secret");
}

export { normalizarStatus };
