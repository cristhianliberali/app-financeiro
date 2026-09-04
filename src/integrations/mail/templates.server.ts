/**
 * Mensagens que o app envia.
 *
 * O visual segue o do produto — preto e branco, sem imagem externa —, e tudo
 * vai em estilo inline: cliente de e-mail ignora folha de estilo. Cada mensagem
 * tem também a versão em texto puro, obrigatória para não cair em spam por
 * "HTML sem alternativa".
 */
import { sendMail } from "./mailer.server";

/** Escapa o que veio do usuário (nome, e-mail) antes de entrar no HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(input: { title: string; body: string; footer?: string }): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Inter,Helvetica,Arial,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:16px;">
      <tr>
        <td style="padding:28px 28px 0 28px;">
          <div style="display:inline-block;width:28px;height:28px;background:#171717;border-radius:8px;vertical-align:middle;"></div>
          <span style="margin-left:8px;font-size:18px;font-weight:700;letter-spacing:-0.02em;vertical-align:middle;">AURA</span>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px 28px 28px;">
          <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;letter-spacing:-0.02em;">${escapeHtml(input.title)}</h1>
          ${input.body}
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 28px 28px;color:#737373;font-size:12px;line-height:1.6;">
          ${input.footer ?? "Se você não pediu isto, ignore esta mensagem — nada muda sem a confirmação."}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#404040;">${text}</p>`;
}

function greeting(name: string | null): string {
  return name?.trim() ? `Olá, ${escapeHtml(name.trim())}!` : "Olá!";
}

/** Link de redefinição de senha, com prazo de validade. */
export async function sendPasswordResetEmail(input: {
  to: string;
  name: string | null;
  link: string;
  expiresInMinutes: number;
}): Promise<void> {
  const { to, name, link, expiresInMinutes } = input;

  await sendMail({
    to,
    subject: "Redefinição de senha — Aura Finanças",
    text: [
      greeting(name),
      "",
      "Recebemos um pedido para redefinir a senha da sua conta na Aura Finanças.",
      `Abra o link abaixo para escolher uma nova senha (vale por ${expiresInMinutes} minutos):`,
      link,
      "",
      "Se não foi você, ignore esta mensagem: sua senha continua a mesma.",
    ].join("\n"),
    html: layout({
      title: "Redefinir sua senha",
      body: [
        paragraph(greeting(name)),
        paragraph(
          "Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova.",
        ),
        `<p style="margin:20px 0;">
           <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#171717;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">Escolher nova senha</a>
         </p>`,
        paragraph(
          `O link vale por ${expiresInMinutes} minutos e só pode ser usado uma vez. ` +
            "Se o botão não funcionar, copie e cole este endereço no navegador:",
        ),
        `<p style="margin:0;font-size:12px;word-break:break-all;color:#737373;">${escapeHtml(link)}</p>`,
      ].join("\n"),
      footer: "Se você não pediu a redefinição, ignore esta mensagem — sua senha continua a mesma.",
    }),
  });
}

/** Código de confirmação enviado ao endereço NOVO na troca de e-mail. */
export async function sendEmailChangeCodeEmail(input: {
  to: string;
  name: string | null;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  const { to, name, code, expiresInMinutes } = input;

  await sendMail({
    to,
    subject: `Seu código de confirmação: ${code}`,
    text: [
      greeting(name),
      "",
      `Use o código ${code} para confirmar este endereço como o novo e-mail da sua conta na Aura Finanças.`,
      `O código vale por ${expiresInMinutes} minutos.`,
      "",
      "Se não foi você, ignore esta mensagem: o e-mail da conta não muda sem o código.",
    ].join("\n"),
    html: layout({
      title: "Confirme seu novo e-mail",
      body: [
        paragraph(greeting(name)),
        paragraph("Use o código abaixo para confirmar este endereço como o e-mail da sua conta:"),
        `<p style="margin:20px 0;padding:16px;background:#f5f5f5;border-radius:12px;text-align:center;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;">${escapeHtml(code)}</p>`,
        paragraph(`O código vale por ${expiresInMinutes} minutos.`),
      ].join("\n"),
      footer:
        "Se você não pediu a troca, ignore esta mensagem — o e-mail da conta não muda sem o código.",
    }),
  });
}

/** Aviso ao endereço ANTIGO de que o e-mail da conta mudou. */
export async function sendEmailChangedNoticeEmail(input: {
  to: string;
  name: string | null;
  newEmail: string;
}): Promise<void> {
  const { to, name, newEmail } = input;

  await sendMail({
    to,
    subject: "O e-mail da sua conta foi alterado",
    text: [
      greeting(name),
      "",
      `O e-mail de acesso da sua conta na Aura Finanças passou a ser ${newEmail}.`,
      "",
      "Se não foi você, procure quem administra o app imediatamente.",
    ].join("\n"),
    html: layout({
      title: "O e-mail da sua conta mudou",
      body: [
        paragraph(greeting(name)),
        paragraph(
          `O e-mail de acesso da sua conta passou a ser <strong>${escapeHtml(newEmail)}</strong>. ` +
            "Este endereço não entra mais no app.",
        ),
      ].join("\n"),
      footer: "Se não foi você, procure imediatamente quem administra o app.",
    }),
  });
}

/**
 * Acesso liberado pela compra: o e-mail que carrega a senha provisória.
 *
 * É a única mensagem do app que leva uma credencial no corpo, e o texto assume
 * isso em vez de disfarçar: diz que a senha é provisória, pede a troca e explica
 * de onde ela veio. Quem recebe não pediu nada — comprou —, e um e-mail com
 * senha que não explica o motivo parece exatamente com um golpe.
 *
 * `novaConta` muda duas frases, não o formato: quem já tinha conta precisa saber
 * que a senha antiga deixou de valer, e quem não tinha precisa saber que a conta
 * acabou de nascer.
 */
export async function sendAccessProvisionedEmail(input: {
  to: string;
  name: string | null;
  senha: string;
  link: string;
  novaConta: boolean;
  /** Nome da oferta comprada, quando o webhook trouxe. */
  plano?: string | null;
}): Promise<void> {
  const { to, name, senha, link, novaConta, plano } = input;

  const abertura = novaConta
    ? "Sua assinatura foi confirmada e sua conta na Aura Finanças já está pronta."
    : "Sua assinatura foi confirmada. Como você já tinha uma conta aqui, geramos uma senha " +
      "provisória nova para ela — a anterior deixou de valer.";

  const detalhePlano = plano ? ` Plano: ${plano}.` : "";

  await sendMail({
    to,
    subject: "Seu acesso à Aura Finanças",
    text: [
      greeting(name),
      "",
      abertura + detalhePlano,
      "",
      "Entre com estes dados:",
      `E-mail: ${to}`,
      `Senha provisória: ${senha}`,
      "",
      link,
      "",
      "Troque a senha no primeiro acesso, em Meu perfil. Enquanto não trocar, ela continua " +
        "valendo — e continua nesta caixa de entrada.",
    ].join("\n"),
    html: layout({
      title: novaConta ? "Sua conta está pronta" : "Seu acesso foi renovado",
      body: [
        paragraph(greeting(name)),
        paragraph(escapeHtml(abertura + detalhePlano)),
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;width:100%;background:#f5f5f5;border-radius:12px;">
           <tr><td style="padding:16px 18px;">
             <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#737373;">E-mail</p>
             <p style="margin:0 0 14px 0;font-size:14px;font-weight:600;">${escapeHtml(to)}</p>
             <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#737373;">Senha provisória</p>
             <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:22px;font-weight:700;letter-spacing:0.06em;">${escapeHtml(senha)}</p>
           </td></tr>
         </table>`,
        `<p style="margin:20px 0;">
           <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#171717;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;">Entrar na minha conta</a>
         </p>`,
        paragraph(
          "Troque a senha no primeiro acesso, em <strong>Meu perfil</strong>. Enquanto não trocar, " +
            "ela continua valendo — e continua nesta caixa de entrada.",
        ),
        `<p style="margin:0;font-size:12px;word-break:break-all;color:#737373;">${escapeHtml(link)}</p>`,
      ].join("\n"),
      footer:
        "Você está recebendo esta mensagem porque uma assinatura foi confirmada para este " +
        "endereço. Se não foi você, procure quem administra o app.",
    }),
  });
}
