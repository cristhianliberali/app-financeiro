/**
 * Cliente da API pública da Cakto.
 *
 * Metade opcional da integração. O acesso ao app **não depende** deste arquivo:
 * quem define o status de cada assinante é o webhook, e ele funciona sem
 * nenhuma credencial de API. O que está aqui serve para o app perguntar algo à
 * Cakto — hoje, o "testar conexão" do painel do super admin.
 *
 * Isso é deliberado. Um gateway fora do ar não pode virar um app fora do ar:
 * se a decisão de acesso dependesse de uma chamada HTTP no login, uma
 * instabilidade da Cakto trancaria todo mundo para fora dos próprios dados.
 * O estado vive no nosso banco; a rede é só como ele chega até lá.
 *
 * Autenticação: OAuth2 client credentials (`client_id`/`client_secret` gerados
 * no painel) trocados por um access token de vida curta, mandado depois em
 * `Authorization: Bearer`. Não há endpoint de renovação — token vencido é
 * token novo, e é o que o cache abaixo faz sozinho.
 */
import { getCaktoSettings } from "@/integrations/postgres/config.server";

type TokenCache = { token: string; expiraEm: number };

let cache: TokenCache | undefined;

/** Margem de segurança para não usar um token que vence no meio do voo. */
const MARGEM_MS = 60_000;

export class CaktoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaktoApiError";
  }
}

async function obterToken(): Promise<string> {
  const agora = Date.now();
  if (cache && cache.expiraEm - MARGEM_MS > agora) return cache.token;

  const { clientId, clientSecret, apiBaseUrl } = getCaktoSettings();
  if (!clientId || !clientSecret) {
    throw new CaktoApiError(
      "API da Cakto não configurada. Defina CAKTO_CLIENT_ID e CAKTO_CLIENT_SECRET " +
        "(o webhook funciona sem elas; isto é só para consultar a Cakto).",
      0,
    );
  }

  const resposta = await fetch(`${apiBaseUrl}/public_api/auth/token/`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const corpo = (await resposta.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    detail?: string;
  } | null;

  if (!resposta.ok || !corpo?.access_token) {
    throw new CaktoApiError(
      corpo?.detail ?? `A Cakto recusou as credenciais (HTTP ${resposta.status}).`,
      resposta.status,
    );
  }

  cache = {
    token: corpo.access_token,
    expiraEm: agora + (corpo.expires_in ?? 3600) * 1000,
  };
  return cache.token;
}

/** Requisição autenticada a um caminho sob `/public_api`. */
export async function caktoRequest<T>(
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { apiBaseUrl } = getCaktoSettings();
  const token = await obterToken();

  const resposta = await fetch(`${apiBaseUrl}/public_api/${caminho.replace(/^\/+/, "")}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");
    throw new CaktoApiError(
      `A Cakto respondeu HTTP ${resposta.status} em ${caminho}${detalhe ? `: ${detalhe.slice(0, 300)}` : ""}`,
      resposta.status,
    );
  }

  return (await resposta.json()) as T;
}

export type WebhookCakto = {
  id?: string | number;
  url?: string;
  events?: unknown;
  active?: boolean;
};

/**
 * Lista os webhooks cadastrados no painel.
 *
 * É o teste de conexão do painel do super admin, e não é uma escolha
 * arbitrária: além de provar que as credenciais valem, a resposta mostra
 * **para qual URL** a Cakto está mandando os eventos. "Assinei e não liberou"
 * quase sempre é um webhook apontando para o lugar errado, e essa é a tela que
 * responde isso sem sair do app.
 */
export async function listarWebhooks(): Promise<WebhookCakto[]> {
  const corpo = await caktoRequest<unknown>("webhook/");
  if (Array.isArray(corpo)) return corpo as WebhookCakto[];
  if (
    corpo &&
    typeof corpo === "object" &&
    Array.isArray((corpo as { results?: unknown }).results)
  ) {
    return (corpo as { results: WebhookCakto[] }).results;
  }
  return [];
}

/** Zera o token em cache — usado quando as credenciais mudam. */
export function esquecerToken(): void {
  cache = undefined;
}
