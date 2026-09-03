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
  // Confirmados em payloads reais desta conta:
  purchase_approved: "ativo",
  subscription_created: "ativo",
  subscription_resumed: "ativo",
  subscription_canceled: "cancelado",
  subscription_paused: "pausado",
  subscription_renewal_refused: "atrasado",
  refund: "reembolsado",
  chargeback: "chargeback",

  // Documentados mas ainda não vistos aqui, e variações de grafia do mesmo
  // evento. Não custam nada e evitam que uma renomeação do lado da Cakto vire
  // assinante bloqueado.
  subscription_renewed: "ativo",
  subscription_renewal: "ativo",
  subscription_reactivated: "ativo",
  purchase_approved_recurring: "ativo",
  compra_aprovada: "ativo",
  assinatura_criada: "ativo",
  assinatura_renovada: "ativo",
  subscription_trial: "trial",
  trial_started: "trial",
  purchase_refused: "atrasado",
  purchase_declined: "atrasado",
  compra_recusada: "atrasado",
  payment_failed: "atrasado",
  subscription_payment_failed: "atrasado",
  subscription_late: "atrasado",
  subscription_cancelled: "cancelado",
  subscription_expired: "cancelado",
  assinatura_cancelada: "cancelado",
  refunded: "reembolsado",
  purchase_refunded: "reembolsado",
  reembolso: "reembolsado",
  purchase_chargeback: "chargeback",
};

/**
 * Rede de segurança para evento desconhecido — e só para **restringir**.
 *
 * A tentação seria ler o campo `status` do pedido e confiar nele. Os payloads
 * reais mostram por que isso seria um furo grave: no `chargeback` e no
 * `subscription_renewal_refused` desta conta, `data[0].status` vale `"paid"` e
 * `subscription.status` vale `"active"` — os dois descrevem o *pedido que um
 * dia foi pago*, não o estado atual da assinatura. Um mapa permissivo daria
 * acesso a quem acabou de dar chargeback.
 *
 * (No sentido contrário o campo é igualmente traiçoeiro: no `purchase_approved`
 * real, `subscription.status` vale `"inactive"` numa compra aprovada.)
 *
 * Então a regra é assimétrica, de propósito: **o nome do evento é a única coisa
 * que libera acesso**. O status cru só serve para tirá-lo, quando fala de algo
 * inequivocamente ruim. Errar restringindo custa um ticket de suporte; errar
 * liberando custa o produto.
 */
const STATUS_CAKTO_RESTRITIVO: Record<string, StatusPlano> = {
  refunded: "reembolsado",
  reembolsado: "reembolsado",
  chargeback: "chargeback",
  canceled: "cancelado",
  cancelled: "cancelado",
  cancelado: "cancelado",
  expired: "cancelado",
  paused: "pausado",
  pausada: "pausado",
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
 * Acha o objeto do pedido dentro do corpo.
 *
 * Na Cakto real, `data` é uma **lista** — sempre com um item, mas lista:
 *
 *     { "secret": "…", "event": "purchase_approved", "data": [ { … } ] }
 *
 * A documentação descreve `data` como objeto, e ler só o objeto foi o bug que
 * os payloads reais revelaram: todo campo saía nulo, todo webhook virava
 * "sem conta correspondente" e nenhuma compra liberava acesso. As três formas
 * são aceitas agora — lista, objeto e campos na raiz —, porque qual delas chega
 * é justamente o tipo de detalhe que muda sem aviso.
 *
 * Só o primeiro item da lista é lido. Nenhum payload observado traz mais de um,
 * e um segundo pedido no mesmo evento seria uma mudança de contrato grande o
 * bastante para merecer uma decisão explícita, não um laço improvisado aqui.
 */
function corpoDoPedido(corpo: unknown): unknown {
  const data = noCaminho(corpo, "data");
  if (Array.isArray(data)) return isObjeto(data[0]) ? data[0] : corpo;
  if (isObjeto(data)) return data;
  return corpo;
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

  const dados = corpoDoPedido(corpo);

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
        "subscription.customer.email",
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
      // Nos payloads reais `subscription.offer` é o próprio código, em texto.
      "subscription.offer",
    ),
    nomeOferta: texto(dados, "offer.name", "offer_name", "oferta.nome", "product.name"),
    assinaturaId: texto(
      dados,
      "subscription.id",
      "subscription_id",
      "subscriptionId",
      "assinatura.id",
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

  // Evento desconhecido: só o que restringe passa. Ver o comentário de
  // STATUS_CAKTO_RESTRITIVO — o `status` do pedido não prova acesso.
  return STATUS_CAKTO_RESTRITIVO[normalizarNomeEvento(statusCakto)] ?? null;
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
