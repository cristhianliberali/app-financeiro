import { createServerFn } from "@tanstack/react-start";

import { requireAuth, type AuthedUser } from "@/integrations/postgres/auth-middleware";
import { MIN_PASSWORD } from "./auth.functions";
import { siteUrl } from "./site-url";
import { isStartRoute, type StartRoute } from "./start-route";

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Informe ${field}`);
  return value.trim();
}

/** A tela avisa quando o SMTP não está de pé, em vez de falhar só no envio. */
export const getMailConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean }> => {
    const { isSmtpConfigured } = await import("@/integrations/postgres/config.server");
    return { enabled: isSmtpConfigured() };
  },
);

export const updateProfileName = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { name: string }) => ({ name: (input?.name ?? "").trim() }))
  .handler(async ({ data, context }): Promise<AuthedUser> => {
    const { updateUserName } = await import("@/integrations/postgres/profile.server");
    const user = await updateUserName(context.user.id, data.name || null);
    return {
      id: user.id,
      email: user.email,
      name: user.full_name,
      startRoute: user.start_route,
    };
  });

/**
 * Salva a tela de abertura.
 *
 * A validação é aqui, no servidor, e não só no `<select>`: o caminho vira
 * destino de navegação assim que a pessoa abre o app, e ele precisa vir da
 * lista fechada, não de quem chama a função.
 */
export const updateStartRoute = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { startRoute: string }): { startRoute: StartRoute } => {
    if (!isStartRoute(input?.startRoute)) throw new Error("Tela de inicialização inválida");
    return { startRoute: input.startRoute };
  })
  .handler(async ({ data, context }): Promise<AuthedUser> => {
    const { updateStartRoute: run } = await import("@/integrations/postgres/profile.server");
    const user = await run(context.user.id, data.startRoute);
    return {
      id: user.id,
      email: user.email,
      name: user.full_name,
      startRoute: user.start_route,
    };
  });

/** Envia o código de confirmação para o endereço novo. */
export const requestEmailChange = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { email: string }) => ({ email: requireText(input?.email, "o e-mail") }))
  .handler(async ({ data, context }): Promise<{ newEmail: string; expiresInMinutes: number }> => {
    const { requestEmailChange: run } = await import("@/integrations/postgres/profile.server");
    return run(context.user.id, data.email);
  });

export const confirmEmailChange = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { code: string }) => ({ code: requireText(input?.code, "o código") }))
  .handler(async ({ data, context }): Promise<AuthedUser> => {
    const { confirmEmailChange: run } = await import("@/integrations/postgres/profile.server");
    const user = await run(context.user.id, data.code);
    return {
      id: user.id,
      email: user.email,
      name: user.full_name,
      startRoute: user.start_route,
    };
  });

export const cancelEmailChange = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<null> => {
    const { cancelEmailChange: run } = await import("@/integrations/postgres/profile.server");
    await run(context.user.id);
    return null;
  });

/** Troca pendente, para a tela reabrir no passo do código depois de um F5. */
export const getPendingEmailChange = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<{ newEmail: string; expiresInMinutes: number } | null> => {
    const { pendingEmailChange } = await import("@/integrations/postgres/profile.server");
    return pendingEmailChange(context.user.id);
  });

/**
 * Pede o link de redefinição. Responde sempre igual, exista ou não o cadastro:
 * a tela não pode virar um verificador de quem tem conta no app.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => ({ email: requireText(input?.email, "o e-mail") }))
  .handler(async ({ data }): Promise<null> => {
    const { requestPasswordReset: run } = await import("@/integrations/postgres/profile.server");
    await run(data.email, (token) => siteUrl(`/redefinir-senha?token=${token}`));
    return null;
  });

export const checkPasswordResetToken = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => ({ token: requireText(input?.token, "o token") }))
  .handler(async ({ data }): Promise<{ valid: boolean }> => {
    const { isPasswordResetTokenValid } = await import("@/integrations/postgres/profile.server");
    return { valid: await isPasswordResetTokenValid(data.token) };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; password: string }) => {
    const token = requireText(input?.token, "o token");
    const password = input?.password ?? "";
    if (password.length < MIN_PASSWORD) {
      throw new Error(`A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    return { token, password };
  })
  .handler(async ({ data }): Promise<null> => {
    const { resetPassword: run } = await import("@/integrations/postgres/profile.server");
    await run(data.token, data.password);
    return null;
  });
