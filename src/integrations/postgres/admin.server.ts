/**
 * Consultas do painel de super admin.
 *
 * Tudo aqui pressupõe que quem chama já provou ser super admin — a checagem
 * vive no middleware `requireSuperAdmin`, em `admin.functions.ts`, e não é
 * repetida em cada consulta. Este módulo é a camada de dados; a permissão é
 * decidida uma vez, na entrada.
 */
import type { StatusPlano } from "@/lib/plano";

import { query, queryOne } from "./client.server";

export type UsuarioAdmin = {
  id: string;
  email: string;
  full_name: string | null;
  status_plano: StatusPlano;
  codigo_oferta: string | null;
  plano_expira_em: Date | null;
  plano_origem: string | null;
  plano_atualizado_em: Date | null;
  plano_observacao: string | null;
  cakto_subscription_id: string | null;
  is_super_admin: boolean;
  created_at: Date;
  /** Última vez que uma sessão desta pessoa foi vista. Nulo = nunca entrou. */
  ultimo_acesso: Date | null;
  /** Contas de que a pessoa é dona — o tamanho real do que ela usa. */
  contas: number;
};

export type FiltroUsuarios = {
  busca?: string;
  status?: StatusPlano | "todos";
  limite: number;
  offset: number;
};

export async function listarUsuarios(
  filtro: FiltroUsuarios,
): Promise<{ itens: UsuarioAdmin[]; total: number }> {
  const busca = filtro.busca?.trim() ? `%${filtro.busca.trim().toLowerCase()}%` : null;
  const status = filtro.status && filtro.status !== "todos" ? filtro.status : null;

  // O mesmo WHERE serve à página e à contagem; escrevê-lo duas vezes é como se
  // chega numa paginação que discorda do próprio total.
  const filtros = `
    WHERE ($1::text IS NULL OR lower(u.email) LIKE $1 OR lower(coalesce(u.full_name,'')) LIKE $1)
      AND ($2::text IS NULL OR u.status_plano = $2)`;

  const itens = await query<UsuarioAdmin>(
    `SELECT u.id, u.email, u.full_name, u.status_plano, u.codigo_oferta, u.plano_expira_em,
            u.plano_origem, u.plano_atualizado_em, u.plano_observacao, u.cakto_subscription_id,
            u.is_super_admin, u.created_at,
            (SELECT max(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS ultimo_acesso,
            (SELECT count(*)::int FROM accounts a WHERE a.owner_id = u.id) AS contas
       FROM app_users u
       ${filtros}
      ORDER BY u.created_at DESC
      LIMIT $3 OFFSET $4`,
    [busca, status, filtro.limite, filtro.offset],
  );

  const total = await queryOne<{ total: number }>(
    `SELECT count(*)::bigint AS total FROM app_users u ${filtros}`,
    [busca, status],
  );

  return { itens, total: total?.total ?? 0 };
}

export type MetricasAdmin = {
  porStatus: Record<string, number>;
  total: number;
  /** Liberados de fato: os status que dão acesso, já descontados os vencidos. */
  liberados: number;
  novosNaSemana: number;
  eventosComProblema: number;
};

export async function lerMetricas(toleranciaDias: number): Promise<MetricasAdmin> {
  const porStatus = await query<{ status_plano: string; total: number }>(
    `SELECT status_plano, count(*)::bigint AS total FROM app_users GROUP BY status_plano`,
  );

  const resumo = await queryOne<{
    total: number;
    liberados: number;
    novos: number;
  }>(
    `SELECT count(*)::bigint AS total,
            count(*) FILTER (
              WHERE status_plano IN ('ativo','trial','cortesia')
                AND (plano_expira_em IS NULL
                     OR plano_expira_em + ($1 || ' days')::interval > now())
            )::bigint AS liberados,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::bigint AS novos
       FROM app_users`,
    [String(toleranciaDias)],
  );

  const problemas = await queryOne<{ total: number }>(
    `SELECT count(*)::bigint AS total FROM cakto_webhook_events
      WHERE situacao IN ('erro','sem_usuario')`,
  );

  return {
    porStatus: Object.fromEntries(porStatus.map((r) => [r.status_plano, r.total])),
    total: resumo?.total ?? 0,
    liberados: resumo?.liberados ?? 0,
    novosNaSemana: resumo?.novos ?? 0,
    eventosComProblema: problemas?.total ?? 0,
  };
}

/** Corpo do webhook como o driver o devolve do `jsonb` — JSON, e nada além. */
export type Json = string | number | boolean | null | Json[] | { [chave: string]: Json };

export type EventoAdmin = {
  id: string;
  evento: string;
  evento_externo: string | null;
  situacao: string;
  detalhe: string | null;
  email: string | null;
  codigo_oferta: string | null;
  status_aplicado: string | null;
  user_id: string | null;
  user_email: string | null;
  recebido_em: Date;
  processado_em: Date | null;
  payload: Json;
};

export async function listarEventos(filtro: {
  situacao?: string;
  limite: number;
  offset: number;
}): Promise<{ itens: EventoAdmin[]; total: number }> {
  const situacao = filtro.situacao && filtro.situacao !== "todos" ? filtro.situacao : null;

  const itens = await query<EventoAdmin>(
    `SELECT e.id, e.evento, e.evento_externo, e.situacao, e.detalhe, e.email, e.codigo_oferta,
            e.status_aplicado, e.user_id, u.email AS user_email, e.recebido_em, e.processado_em,
            e.payload
       FROM cakto_webhook_events e
       LEFT JOIN app_users u ON u.id = e.user_id
      WHERE ($1::text IS NULL OR e.situacao = $1)
      ORDER BY e.recebido_em DESC
      LIMIT $2 OFFSET $3`,
    [situacao, filtro.limite, filtro.offset],
  );

  const total = await queryOne<{ total: number }>(
    `SELECT count(*)::bigint AS total FROM cakto_webhook_events
      WHERE ($1::text IS NULL OR situacao = $1)`,
    [situacao],
  );

  return { itens, total: total?.total ?? 0 };
}

/** Marca ou desmarca alguém como super admin. */
export async function definirSuperAdmin(userId: string, valor: boolean): Promise<void> {
  await query(`UPDATE app_users SET is_super_admin = $2, updated_at = now() WHERE id = $1`, [
    userId,
    valor,
  ]);
}

/** Quantos super admins existem — usado para não deixar o app sem nenhum. */
export async function contarSuperAdmins(): Promise<number> {
  const row = await queryOne<{ total: number }>(
    `SELECT count(*)::bigint AS total FROM app_users WHERE is_super_admin = true`,
  );
  return row?.total ?? 0;
}

export async function buscarUsuarioPorId(userId: string): Promise<UsuarioAdmin | null> {
  return queryOne<UsuarioAdmin>(
    `SELECT u.id, u.email, u.full_name, u.status_plano, u.codigo_oferta, u.plano_expira_em,
            u.plano_origem, u.plano_atualizado_em, u.plano_observacao, u.cakto_subscription_id,
            u.is_super_admin, u.created_at,
            (SELECT max(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS ultimo_acesso,
            (SELECT count(*)::int FROM accounts a WHERE a.owner_id = u.id) AS contas
       FROM app_users u WHERE u.id = $1`,
    [userId],
  );
}
