/**
 * Criar a conta e entregar o acesso quando uma assinatura nasce.
 *
 * Roda **só** no evento `subscription_created` (ver `ehEventoDeProvisionamento`
 * em `contrato.ts`). Uma compra dispara também `purchase_approved` com o mesmo
 * pedido; provisionar nos dois mandaria duas senhas diferentes para a mesma
 * pessoa, e ela não teria como saber qual vale.
 *
 * O módulo tem uma regra que organiza tudo o mais: **nunca deixar alguém que
 * pagou sem caminho de entrada, e nunca tirar o caminho de quem já tinha um.**
 * É dela que saem as três recusas abaixo — sem SMTP, sem e-mail no webhook, e
 * super admin — e a trava de "uma vez só".
 */
import {
  aplicarSenhaProvisoria,
  criarUsuarioProvisionado,
  normalizeEmail,
} from "@/integrations/postgres/users.server";
import { queryOne } from "@/integrations/postgres/client.server";
import { isProvisionamentoAtivo } from "@/integrations/postgres/config.server";
import { siteUrl } from "@/lib/site-url";

import type { EventoCakto } from "./contrato";

export type ResultadoProvisionamento = {
  /** `null` quando nada foi feito. */
  userId: string | null;
  /** O que aconteceu, em uma frase — vai para o detalhe do evento no painel. */
  detalhe: string;
  conta: "criada" | "senha_renovada" | "inalterada";
};

type ContaExistente = {
  id: string;
  full_name: string | null;
  is_super_admin: boolean;
  acesso_provisionado_em: Date | null;
};

const nada = (detalhe: string, userId: string | null = null): ResultadoProvisionamento => ({
  userId,
  detalhe,
  conta: "inalterada",
});

/**
 * Garante que quem comprou consiga entrar.
 *
 * Nunca lança: uma falha de SMTP não pode desfazer a assinatura que a Cakto já
 * confirmou. O que dá errado vira texto no detalhe do evento, visível no painel,
 * de onde o super admin reprocessa ou resolve na mão.
 */
export async function provisionarAcesso(lido: EventoCakto): Promise<ResultadoProvisionamento> {
  if (!isProvisionamentoAtivo()) {
    return nada("Provisionamento desligado (CAKTO_PROVISIONAR_ACESSO ou SMTP ausente)");
  }
  if (!lido.email) {
    return nada("Evento sem e-mail de cliente — não há para quem mandar o acesso");
  }

  const email = normalizeEmail(lido.email);
  const existente = await queryOne<ContaExistente>(
    `SELECT id, full_name, is_super_admin, acesso_provisionado_em
       FROM app_users WHERE email = $1`,
    [email],
  );

  // Trava de "uma vez só". Sem ela, o botão Reprocessar do painel geraria uma
  // senha nova a cada clique e a pessoa acumularia senhas na caixa de entrada
  // sem saber qual vale.
  if (existente?.acesso_provisionado_em) {
    return nada(`Acesso de ${email} já havia sido enviado`, existente.id);
  }

  // Um super admin que compra a própria assinatura para testar não pode ter a
  // senha trocada por baixo: ele perderia o painel no meio do teste, e o painel
  // é justamente onde se conserta o que der errado aqui.
  if (existente?.is_super_admin) {
    return nada(`${email} é super admin — senha preservada, acesso já garantido`, existente.id);
  }

  const { gerarSenhaProvisoria } = await import("@/integrations/postgres/password.server");
  const senha = gerarSenhaProvisoria();

  const novaConta = !existente;
  let userId: string;
  let nome: string | null;

  if (existente) {
    await aplicarSenhaProvisoria(existente.id, senha);
    userId = existente.id;
    nome = existente.full_name;
  } else {
    const criado = await criarUsuarioProvisionado({ email, senha, nome: lido.nome });
    if (!criado) {
      // Dois webhooks do mesmo comprador ao mesmo tempo: o outro criou a conta
      // entre a consulta e o insert. Quem chegou primeiro já mandou a senha.
      return nada(`Conta de ${email} criada por outro evento em paralelo`);
    }
    userId = criado.id;
    nome = criado.full_name;
  }

  try {
    const { sendAccessProvisionedEmail } = await import("@/integrations/mail/templates.server");
    await sendAccessProvisionedEmail({
      to: email,
      name: nome,
      senha,
      link: siteUrl("/auth"),
      novaConta,
      plano: lido.nomeOferta,
    });
  } catch (error) {
    // A conta existe e a senha já é a nova — só o e-mail não saiu. Dizer isso
    // com todas as letras importa: a saída é o super admin gerar outra senha
    // pelo painel, não reprocessar o evento (que agora encontra a trava).
    const motivo = error instanceof Error ? error.message : String(error);
    console.error(`[cakto] acesso de ${email} criado, mas o e-mail falhou:`, motivo);
    return {
      userId,
      conta: novaConta ? "criada" : "senha_renovada",
      detalhe:
        `Conta ${novaConta ? "criada" : "atualizada"}, mas o e-mail com a senha NÃO foi enviado ` +
        `(${motivo}). Gere uma senha nova para ${email} pelo painel.`,
    };
  }

  return {
    userId,
    conta: novaConta ? "criada" : "senha_renovada",
    detalhe: novaConta
      ? `Conta criada para ${email} e senha enviada por e-mail`
      : `${email} já tinha conta — senha provisória nova enviada por e-mail`,
  };
}

/**
 * Gera uma senha provisória nova e reenvia o acesso, a pedido do super admin.
 *
 * É a saída para os dois becos que o provisionamento automático pode deixar: o
 * e-mail que não saiu (SMTP fora no momento da compra) e o que saiu mas não
 * chegou. Reprocessar o evento não resolve nenhum dos dois — a trava de "uma
 * vez só" já está marcada, e é ela que impede a enxurrada de senhas.
 *
 * Diferente do automático, aqui o super admin está olhando e decidiu: por isso
 * não há trava de idempotência. A única recusa é sobre si mesmo, porque trocar a
 * própria senha por uma que vai chegar por e-mail é perder o painel no meio da
 * operação — para isso existe "Meu perfil".
 */
export async function reenviarAcesso(input: {
  userId: string;
  atorId: string;
}): Promise<{ ok: boolean; detalhe: string }> {
  if (input.userId === input.atorId) {
    return {
      ok: false,
      detalhe: "Para trocar a sua própria senha, use Meu perfil — não este botão.",
    };
  }

  const { isSmtpConfigured } = await import("@/integrations/postgres/config.server");
  if (!isSmtpConfigured()) {
    return { ok: false, detalhe: "SMTP não configurado: não há como entregar a senha." };
  }

  const alvo = await queryOne<{ id: string; email: string; full_name: string | null }>(
    `SELECT id, email, full_name FROM app_users WHERE id = $1`,
    [input.userId],
  );
  if (!alvo) return { ok: false, detalhe: "Usuário não encontrado." };

  const { gerarSenhaProvisoria } = await import("@/integrations/postgres/password.server");
  const senha = gerarSenhaProvisoria();
  await aplicarSenhaProvisoria(alvo.id, senha);

  try {
    const { sendAccessProvisionedEmail } = await import("@/integrations/mail/templates.server");
    await sendAccessProvisionedEmail({
      to: alvo.email,
      name: alvo.full_name,
      senha,
      link: siteUrl("/auth"),
      novaConta: false,
    });
  } catch (error) {
    // A senha já foi trocada — dizer isso evita que alguém tente de novo
    // achando que nada aconteceu, e mande a pessoa para uma senha que já morreu.
    const motivo = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detalhe: `A senha foi trocada, mas o e-mail falhou (${motivo}). A senha anterior não vale mais.`,
    };
  }

  return { ok: true, detalhe: `Senha provisória nova enviada para ${alvo.email}.` };
}
