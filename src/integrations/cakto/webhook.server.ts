/**
 * Recebimento e aplicação dos webhooks da Cakto.
 *
 * O fluxo tem duas etapas separadas de propósito:
 *
 *   1. **guardar** o corpo cru em `cakto_webhook_events`, sempre, antes de
 *      qualquer interpretação;
 *   2. **aplicar** o que ele significa em `app_users`.
 *
 * A separação é o que torna a integração recuperável. Se a etapa 2 estiver
 * errada — um campo com outro nome, um evento que a Cakto passou a mandar
 * depois — o corpo original continua no banco e o super admin reprocessa o
 * evento com o código corrigido. Se as duas fossem uma coisa só, um erro de
 * leitura viraria uma compra perdida, e a única saída seria pedir à Cakto que
 * reenviasse algo que ela já entregou com sucesso.
 *
 * Também é por isso que a resposta HTTP é 200 em quase todo caso: o evento foi
 * recebido e está guardado. Devolver erro faria a Cakto reentregar o mesmo
 * corpo que já temos, e o problema não está no transporte.
 */
import { query, queryOne } from "@/integrations/postgres/client.server";
import { aplicarPlano } from "@/integrations/postgres/plano.server";

import { interpretarWebhook, type EventoCakto } from "./contrato";

export type SituacaoEvento = "pendente" | "aplicado" | "ignorado" | "erro" | "sem_usuario";

export type ResultadoWebhook = {
  eventoId: string | null;
  situacao: SituacaoEvento;
  detalhe: string;
  /** `true` quando este corpo já tinha sido recebido antes. */
  duplicado: boolean;
};

type EventoRow = {
  id: string;
  evento: string;
  payload: unknown;
  situacao: SituacaoEvento;
};

/** Guarda o corpo cru. Devolve `null` no `id` quando é reentrega do mesmo evento. */
async function guardarEvento(
  corpo: unknown,
  lido: EventoCakto | null,
): Promise<{ id: string; duplicado: boolean }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO cakto_webhook_events (evento_externo, evento, payload, email, codigo_oferta)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (evento, evento_externo) WHERE evento_externo IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      lido?.eventoExterno ?? null,
      lido?.evento ?? "desconhecido",
      JSON.stringify(corpo ?? null),
      lido?.email ?? null,
      lido?.codigoOferta ?? null,
    ],
  );

  if (row) return { id: row.id, duplicado: false };

  // Conflito: o par (evento, id externo) já estava lá. Só chega aqui com
  // `eventoExterno` preenchido — o índice é parcial e não pega os nulos.
  const existente = await queryOne<{ id: string }>(
    `SELECT id FROM cakto_webhook_events WHERE evento = $1 AND evento_externo = $2
      ORDER BY recebido_em DESC LIMIT 1`,
    [lido?.evento ?? "desconhecido", lido?.eventoExterno ?? null],
  );
  if (existente) return { id: existente.id, duplicado: true };

  // Não deveria acontecer; se acontecer, guardar o corpo importa mais do que
  // manter a idempotência.
  const semChave = await queryOne<{ id: string }>(
    `INSERT INTO cakto_webhook_events (evento, payload, email, codigo_oferta)
     VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
    [
      lido?.evento ?? "desconhecido",
      JSON.stringify(corpo ?? null),
      lido?.email ?? null,
      lido?.codigoOferta ?? null,
    ],
  );
  return { id: semChave!.id, duplicado: false };
}

async function marcar(
  eventoId: string,
  situacao: SituacaoEvento,
  detalhe: string,
  extras: { userId?: string | null; statusAplicado?: string | null } = {},
): Promise<void> {
  await query(
    `UPDATE cakto_webhook_events
        SET situacao = $2, detalhe = $3, user_id = COALESCE($4, user_id),
            status_aplicado = $5, processado_em = now()
      WHERE id = $1`,
    [eventoId, situacao, detalhe, extras.userId ?? null, extras.statusAplicado ?? null],
  );
}

/**
 * Acha a pessoa a quem o evento se refere.
 *
 * O e-mail da compra é o caminho normal. A assinatura é a rede de segurança:
 * quem trocou o e-mail do cadastro depois de assinar continua sendo encontrado
 * pelas renovações, que carregam o mesmo `subscription.id` da compra original.
 */
async function acharUsuario(lido: EventoCakto): Promise<string | null> {
  if (lido.assinaturaId) {
    const porAssinatura = await queryOne<{ id: string }>(
      `SELECT id FROM app_users WHERE cakto_subscription_id = $1 LIMIT 1`,
      [lido.assinaturaId],
    );
    if (porAssinatura) return porAssinatura.id;
  }

  if (lido.email) {
    const porEmail = await queryOne<{ id: string }>(`SELECT id FROM app_users WHERE email = $1`, [
      lido.email,
    ]);
    if (porEmail) return porEmail.id;
  }

  return null;
}

/**
 * Aplica um evento já guardado. É o mesmo caminho do recebimento e do
 * reprocessamento manual — não existem duas versões desta regra.
 */
export async function aplicarEvento(eventoId: string): Promise<ResultadoWebhook> {
  const row = await queryOne<EventoRow>(
    `SELECT id, evento, payload, situacao FROM cakto_webhook_events WHERE id = $1`,
    [eventoId],
  );
  if (!row)
    return { eventoId, situacao: "erro", detalhe: "Evento não encontrado", duplicado: false };

  const lido = interpretarWebhook(row.payload);

  if (!lido) {
    await marcar(eventoId, "ignorado", "Corpo sem nome de evento");
    return {
      eventoId,
      situacao: "ignorado",
      detalhe: "Corpo sem nome de evento",
      duplicado: false,
    };
  }

  if (!lido.status) {
    const detalhe = `Evento "${lido.evento}" não altera o acesso`;
    await marcar(eventoId, "ignorado", detalhe);
    return { eventoId, situacao: "ignorado", detalhe, duplicado: false };
  }

  const userId = await acharUsuario(lido);
  if (!userId) {
    // Não é erro, e não é raro: comprar antes de criar a conta é o caminho
    // normal de quem chega pelo checkout. O evento fica aqui e é aplicado
    // sozinho quando alguém se cadastrar com este e-mail.
    const detalhe = lido.email
      ? `Nenhuma conta com o e-mail ${lido.email}. O acesso é liberado quando ela for criada.`
      : "Evento sem e-mail de cliente — não dá para saber a quem se refere.";
    await marcar(eventoId, "sem_usuario", detalhe);
    return { eventoId, situacao: "sem_usuario", detalhe, duplicado: false };
  }

  try {
    await aplicarPlano({
      userId,
      status: lido.status,
      origem: "cakto",
      // Um cancelamento não traz oferta; `undefined` preserva a que já estava,
      // que é o que diz *qual* plano a pessoa teve.
      ...(lido.codigoOferta ? { codigoOferta: lido.codigoOferta } : {}),
      ...(lido.expiraEm ? { expiraEm: lido.expiraEm } : {}),
      ...(lido.clienteId ? { caktoCustomerId: lido.clienteId } : {}),
      ...(lido.assinaturaId ? { caktoSubscriptionId: lido.assinaturaId } : {}),
      motivo: `Webhook ${lido.evento}`,
      eventoId,
    });
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error);
    await marcar(eventoId, "erro", detalhe, { userId });
    return { eventoId, situacao: "erro", detalhe, duplicado: false };
  }

  const detalhe = `Plano definido como "${lido.status}"`;
  await marcar(eventoId, "aplicado", detalhe, { userId, statusAplicado: lido.status });
  return { eventoId, situacao: "aplicado", detalhe, duplicado: false };
}

/** Caminho completo do endpoint: guardar e aplicar. */
export async function receberWebhook(corpo: unknown): Promise<ResultadoWebhook> {
  const lido = interpretarWebhook(corpo);
  const { id, duplicado } = await guardarEvento(corpo, lido);

  if (duplicado) {
    return {
      eventoId: id,
      situacao: "ignorado",
      detalhe: "Evento já recebido antes",
      duplicado: true,
    };
  }

  return { ...(await aplicarEvento(id)), duplicado: false };
}

/**
 * Aplica os eventos que chegaram antes de a conta existir.
 *
 * Chamado no cadastro: quem comprou e só depois criou a conta entra já
 * liberado, sem passar por um bloqueio que a compra dela já resolveu.
 */
export async function aplicarEventosPendentesDoEmail(email: string): Promise<number> {
  const pendentes = await query<{ id: string }>(
    `SELECT id FROM cakto_webhook_events
      WHERE situacao = 'sem_usuario' AND email = $1
      ORDER BY recebido_em ASC`,
    [email.trim().toLowerCase()],
  );

  let aplicados = 0;
  for (const evento of pendentes) {
    const resultado = await aplicarEvento(evento.id);
    if (resultado.situacao === "aplicado") aplicados += 1;
  }
  return aplicados;
}
