/**
 * Estado da assinatura de cada pessoa, no Postgres.
 *
 * Este módulo é o único lugar que escreve `app_users.status_plano`. Tanto o
 * webhook da Cakto quanto a mão do super admin passam por `aplicarPlano`, e é
 * por isso que `plano_historico` nunca fica com buraco: não existe caminho
 * alternativo até a coluna.
 *
 * A leitura (`lerAcesso`) é o que decide se alguém entra no app. Ela é chamada
 * em toda requisição autenticada de dado, então é uma consulta só, por índice.
 */
import { avaliarPlano, type AvaliacaoPlano, type OrigemPlano, type StatusPlano } from "@/lib/plano";

import { query, queryOne } from "./client.server";
import {
  getPlanoDiasCarencia,
  getPlanoToleranciaDias,
  isAcessoHerdadoPorConvite,
  isPlanoObrigatorio,
  getSuperAdminEmails,
} from "./config.server";

export type PlanoRow = {
  status_plano: StatusPlano;
  codigo_oferta: string | null;
  plano_expira_em: Date | null;
  plano_origem: OrigemPlano | null;
  plano_atualizado_em: Date | null;
  plano_observacao: string | null;
  is_super_admin: boolean;
};

export type Acesso = AvaliacaoPlano & {
  codigoOferta: string | null;
  expiraEm: string | null;
  origem: OrigemPlano | null;
  isSuperAdmin: boolean;
  /**
   * `false` quando `CAKTO_EXIGIR_ASSINATURA` está desligado — aí `liberado` é
   * sempre verdadeiro, e a tela precisa saber que isso veio da configuração e
   * não de uma assinatura paga.
   */
  exigindoAssinatura: boolean;
  /** Acesso que veio da conta de outra pessoa, e não da assinatura própria. */
  herdado: boolean;
};

export async function lerPlano(userId: string): Promise<PlanoRow | null> {
  return queryOne<PlanoRow>(
    `SELECT status_plano, codigo_oferta, plano_expira_em, plano_origem,
            plano_atualizado_em, plano_observacao, is_super_admin
       FROM app_users WHERE id = $1`,
    [userId],
  );
}

/**
 * Decide o acesso de uma pessoa.
 *
 * Três coisas liberam, nesta ordem:
 *
 *   1. ser super admin — quem administra o app não pode ficar do lado de fora
 *      dele por causa de uma assinatura vencida;
 *   2. a própria assinatura estar em dia;
 *   3. ter sido convidada para a conta de alguém cuja assinatura está em dia
 *      (`CAKTO_ACESSO_HERDADO`, ligado por padrão).
 */
export async function lerAcesso(userId: string): Promise<Acesso> {
  const row = await lerPlano(userId);
  const exigindoAssinatura = isPlanoObrigatorio();

  if (!row) {
    return {
      liberado: false,
      status: "sem_assinatura",
      motivo: "sem_assinatura",
      diasRestantes: null,
      codigoOferta: null,
      expiraEm: null,
      origem: null,
      isSuperAdmin: false,
      exigindoAssinatura,
      herdado: false,
    };
  }

  const avaliacao = avaliarPlano(
    {
      status: row.status_plano,
      expiraEm: row.plano_expira_em,
      // Base da carência de `atrasado`: quando a recusa chegou.
      atualizadoEm: row.plano_atualizado_em,
      codigoOferta: row.codigo_oferta,
    },
    { toleranciaDias: getPlanoToleranciaDias(), diasCarencia: getPlanoDiasCarencia() },
  );

  const base = {
    ...avaliacao,
    codigoOferta: row.codigo_oferta,
    expiraEm: row.plano_expira_em ? row.plano_expira_em.toISOString() : null,
    origem: row.plano_origem,
    isSuperAdmin: row.is_super_admin,
    exigindoAssinatura,
    herdado: false,
  };

  if (base.liberado || row.is_super_admin) {
    return { ...base, liberado: true };
  }

  if (isAcessoHerdadoPorConvite() && (await herdaDeAlgumaConta(userId))) {
    return { ...base, liberado: true, motivo: null, herdado: true };
  }

  // Com a trava desligada o app segue aberto — mas o motivo real continua
  // visível, que é o que permite conferir o estado antes de ligá-la.
  return { ...base, liberado: exigindoAssinatura ? base.liberado : true };
}

/**
 * Alguma conta de que esta pessoa participa (sem ser a dona) pertence a um
 * assinante em dia?
 *
 * A avaliação do dono é refeita em SQL em vez de reusar `avaliarPlano` porque
 * são N donos possíveis: trazer todos para o Node só para descartá-los seria
 * uma consulta por membro.
 *
 * A regra aqui é de propósito mais estrita que a de `avaliarPlano`: herda-se de
 * quem está sólido (`ativo`, `trial`, `cortesia`), nunca de quem está só dentro
 * de uma janela de carência. Esticar a carência de um titular inadimplente para
 * a família inteira multiplicaria por N o acesso que ninguém pagou.
 */
async function herdaDeAlgumaConta(userId: string): Promise<boolean> {
  const row = await queryOne<{ existe: boolean }>(
    `SELECT true AS existe
       FROM account_members m
       JOIN accounts a ON a.id = m.account_id
       JOIN app_users dono ON dono.id = a.owner_id
      WHERE m.user_id = $1
        AND dono.id <> $1
        AND (dono.is_super_admin
             OR (dono.status_plano IN ('ativo','trial','cortesia')
                 AND (dono.plano_expira_em IS NULL
                      OR dono.plano_expira_em + ($2 || ' days')::interval > now())))
      LIMIT 1`,
    [userId, String(getPlanoToleranciaDias())],
  );
  return !!row;
}

export type AplicarPlano = {
  userId: string;
  status: StatusPlano;
  origem: OrigemPlano;
  codigoOferta?: string | null;
  expiraEm?: Date | null;
  /** Quem fez a mudança, quando foi manual. */
  atorId?: string | null;
  motivo?: string | null;
  observacao?: string | null;
  eventoId?: string | null;
  caktoCustomerId?: string | null;
  caktoSubscriptionId?: string | null;
};

/**
 * Grava o novo estado e registra a mudança no histórico.
 *
 * `codigoOferta` e `expiraEm` são `undefined` quando o chamador não tem opinião
 * (um cancelamento não traz oferta nova) e `null` quando quer apagar o valor —
 * `COALESCE` no SQL preserva o que já estava no primeiro caso.
 */
export async function aplicarPlano(input: AplicarPlano): Promise<PlanoRow> {
  const anterior = await lerPlano(input.userId);

  const row = await queryOne<PlanoRow>(
    `UPDATE app_users
        SET status_plano = $2::text,
            codigo_oferta = CASE WHEN $3::boolean THEN $4::text ELSE codigo_oferta END,
            plano_expira_em = CASE WHEN $5::boolean THEN $6::timestamptz ELSE plano_expira_em END,
            plano_origem = $7::text,
            plano_observacao = CASE WHEN $8::boolean THEN $9::text ELSE plano_observacao END,
            cakto_customer_id = COALESCE($10::text, cakto_customer_id),
            cakto_subscription_id = COALESCE($11::text, cakto_subscription_id),
            plano_atualizado_em = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING status_plano, codigo_oferta, plano_expira_em, plano_origem,
                plano_atualizado_em, plano_observacao, is_super_admin`,
    [
      input.userId,
      input.status,
      input.codigoOferta !== undefined,
      input.codigoOferta ?? null,
      input.expiraEm !== undefined,
      input.expiraEm ?? null,
      input.origem,
      input.observacao !== undefined,
      input.observacao ?? null,
      input.caktoCustomerId ?? null,
      input.caktoSubscriptionId ?? null,
    ],
  );
  if (!row) throw new Error("Usuário não encontrado");

  await query(
    `INSERT INTO plano_historico
       (user_id, de_status, para_status, codigo_oferta, expira_em, origem, ator_id, motivo, evento_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.userId,
      anterior?.status_plano ?? null,
      input.status,
      row.codigo_oferta,
      row.plano_expira_em,
      input.origem,
      input.atorId ?? null,
      input.motivo ?? null,
      input.eventoId ?? null,
    ],
  );

  return row;
}

export type HistoricoPlano = {
  id: string;
  de_status: StatusPlano | null;
  para_status: StatusPlano;
  codigo_oferta: string | null;
  expira_em: Date | null;
  origem: OrigemPlano;
  motivo: string | null;
  ator_email: string | null;
  created_at: Date;
};

export async function lerHistorico(userId: string, limite = 50): Promise<HistoricoPlano[]> {
  return query<HistoricoPlano>(
    `SELECT h.id, h.de_status, h.para_status, h.codigo_oferta, h.expira_em,
            h.origem, h.motivo, h.created_at, ator.email AS ator_email
       FROM plano_historico h
       LEFT JOIN app_users ator ON ator.id = h.ator_id
      WHERE h.user_id = $1
      ORDER BY h.created_at DESC
      LIMIT $2`,
    [userId, limite],
  );
}

/**
 * Garante que os e-mails de `SUPER_ADMIN_EMAILS` estejam marcados no banco.
 *
 * Roda no login e é idempotente: o `WHERE` já filtra quem falta. Sem isto, a
 * lista de e-mails funcionaria para entrar no painel mas o próprio painel
 * mostraria essas pessoas como usuários comuns — dois lugares dizendo coisas
 * diferentes sobre a mesma permissão.
 */
export async function sincronizarSuperAdmins(): Promise<void> {
  const emails = getSuperAdminEmails();
  if (!emails.length) return;

  await query(
    `UPDATE app_users SET is_super_admin = true, updated_at = now()
      WHERE email = ANY($1::text[]) AND is_super_admin = false`,
    [emails],
  );
}

/** Super admin pela coluna ou pela variável de ambiente. */
export async function isSuperAdmin(user: { id: string; email: string }): Promise<boolean> {
  if (getSuperAdminEmails().includes(user.email.toLowerCase())) return true;
  const row = await queryOne<{ is_super_admin: boolean }>(
    `SELECT is_super_admin FROM app_users WHERE id = $1`,
    [user.id],
  );
  return !!row?.is_super_admin;
}
