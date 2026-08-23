import { createServerFn } from "@tanstack/react-start";

import {
  requireAuth,
  optionalAuth,
  type AuthedUser,
} from "@/integrations/postgres/auth-middleware";

export type { AuthedUser };

/** Regras de senha aplicadas no servidor (o front só espelha na UI). */
const MIN_PASSWORD = 8;

function validateCredentials(input: { email?: string; password?: string }) {
  const email = (input?.email ?? "").trim().toLowerCase();
  const password = input?.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido");
  if (password.length < MIN_PASSWORD) {
    throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
  }
  return { email, password };
}

/**
 * Configuração pública da tela de entrada. Lida em runtime para que ligar ou
 * desligar `CREATE_USERS_HOME` seja só reiniciar o serviço, sem rebuild.
 */
export const getAuthConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ signupEnabled: boolean }> => {
    const { isSignupOpen } = await import("@/integrations/postgres/config.server");
    const { countUsers } = await import("@/integrations/postgres/users.server");

    if (isSignupOpen()) return { signupEnabled: true };

    // Com o cadastro fechado e o banco ainda vazio ninguém conseguiria entrar:
    // liberamos só a criação do primeiro usuário, que vira o dono do app.
    try {
      return { signupEnabled: (await countUsers()) === 0 };
    } catch {
      return { signupEnabled: false };
    }
  },
);

/** Usuário logado, ou `null`. Base do `useAuth()` no cliente. */
export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([optionalAuth])
  .handler(async ({ context }): Promise<AuthedUser | null> => context.user);

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string }) => validateCredentials(input))
  .handler(async ({ data }): Promise<AuthedUser> => {
    const { authenticate } = await import("@/integrations/postgres/users.server");
    const { startSession } = await import("@/integrations/postgres/session.server");

    const user = await authenticate(data.email, data.password);
    if (!user) throw new Error("E-mail ou senha incorretos");

    await startSession(user.id);
    return { id: user.id, email: user.email, name: user.full_name };
  });

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string; name?: string }) => ({
    ...validateCredentials(input),
    name: input?.name?.trim() || null,
  }))
  .handler(async ({ data }): Promise<AuthedUser> => {
    const { isSignupOpen } = await import("@/integrations/postgres/config.server");
    const { createUser, countUsers } = await import("@/integrations/postgres/users.server");
    const { startSession } = await import("@/integrations/postgres/session.server");

    // Mesma regra do `getAuthConfig`, repetida aqui porque o front pode ser
    // contornado: com o cadastro fechado só passa o primeiro usuário do banco.
    if (!isSignupOpen() && (await countUsers()) > 0) {
      throw new Error("O cadastro de novos usuários está desativado");
    }

    const user = await createUser({ email: data.email, password: data.password, name: data.name });
    await startSession(user.id);
    return { id: user.id, email: user.email, name: user.full_name };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async (): Promise<null> => {
  const { endSession } = await import("@/integrations/postgres/session.server");
  await endSession();
  return null;
});

export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { currentPassword: string; newPassword: string }) => {
    if (!input?.currentPassword) throw new Error("Informe a senha atual");
    if ((input?.newPassword ?? "").length < MIN_PASSWORD) {
      throw new Error(`A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    }
    return { currentPassword: input.currentPassword, newPassword: input.newPassword };
  })
  .handler(async ({ data, context }): Promise<null> => {
    const { authenticate, updatePassword } = await import("@/integrations/postgres/users.server");
    const { endAllSessions, startSession } = await import("@/integrations/postgres/session.server");

    const ok = await authenticate(context.user.email, data.currentPassword);
    if (!ok) throw new Error("Senha atual incorreta");

    await updatePassword(context.user.id, data.newPassword);
    // Trocar a senha derruba as sessões antigas; a atual é recriada para que
    // quem fez a troca não seja deslogado do próprio navegador.
    await endAllSessions(context.user.id);
    await startSession(context.user.id);
    return null;
  });
