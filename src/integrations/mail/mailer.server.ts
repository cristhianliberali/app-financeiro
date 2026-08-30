/**
 * Envio de e-mail por SMTP.
 *
 * Toda a configuração vem de variáveis de ambiente (`SMTP_*`), lidas em runtime
 * — trocar de provedor é editar a env do serviço e reiniciar, sem rebuild. Sem
 * `SMTP_HOST` o app inteiro continua de pé: só os fluxos que dependem de e-mail
 * (redefinição de senha e troca de e-mail) recusam com uma mensagem dizendo o
 * que falta configurar.
 *
 * O transporte é criado uma vez e reaproveitado: o nodemailer mantém a conexão
 * em pool, então uma sequência de envios não reabre TLS a cada mensagem.
 */
import type { Transporter } from "nodemailer";

import { getSmtpSettings, isSmtpConfigured, type SmtpSettings } from "../postgres/config.server";

export { isSmtpConfigured };

let transporter: Transporter | undefined;
let transporterKey = "";

/** Identidade da configuração atual: muda quando a env muda, e o pool é refeito. */
function keyOf(settings: SmtpSettings): string {
  return [
    settings.host,
    settings.port,
    settings.secure,
    settings.user ?? "",
    settings.from,
    settings.rejectUnauthorized,
  ].join("|");
}

async function getTransporter(): Promise<{ transporter: Transporter; settings: SmtpSettings }> {
  const settings = getSmtpSettings();
  const key = keyOf(settings);

  if (!transporter || transporterKey !== key) {
    const nodemailer = (await import("nodemailer")).default;
    transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      ...(settings.user ? { auth: { user: settings.user, pass: settings.password ?? "" } } : {}),
      // Sem isto, um SMTP interno com certificado autoassinado derrubaria o
      // envio — que é justamente o caso de quem hospeda o próprio servidor.
      tls: { rejectUnauthorized: settings.rejectUnauthorized },
      pool: true,
      maxConnections: 3,
    });
    transporterKey = key;
  }

  return { transporter, settings };
}

export type MailMessage = {
  to: string;
  subject: string;
  /** Versão em texto puro, para clientes que não renderizam HTML. */
  text: string;
  html: string;
};

export async function sendMail(message: MailMessage): Promise<void> {
  const { transporter: mailer, settings } = await getTransporter();

  const info = await mailer.sendMail({
    from: { name: settings.fromName, address: settings.from },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  console.info(`[smtp] enviado para ${message.to}: "${message.subject}" (${info.messageId})`);
}

/** Verifica a conexão SMTP sem enviar mensagem — usado no diagnóstico da tela. */
export async function verifySmtp(): Promise<void> {
  const { transporter: mailer } = await getTransporter();
  await mailer.verify();
}
