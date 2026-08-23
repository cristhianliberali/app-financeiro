import { createServerFn } from "@tanstack/react-start";

import { requireAuth } from "@/integrations/postgres/auth-middleware";

export type AccountRole = "owner" | "editor" | "viewer";

function requireId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} é obrigatório`);
  return value;
}

function requireRole(value: unknown): AccountRole {
  if (value === "owner" || value === "editor" || value === "viewer") return value;
  throw new Error("Papel inválido");
}

export const fetchAccounts = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { listAccounts } = await import("@/integrations/postgres/accounts.server");
    return listAccounts(context.user.id, context.user.email);
  });

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { name: string; color: string }) => {
    const name = (input?.name ?? "").trim();
    if (!name) throw new Error("Informe o nome da conta");
    return { name, color: input?.color || "#3B82F6" };
  })
  .handler(async ({ data, context }) => {
    const { createAccount: run } = await import("@/integrations/postgres/accounts.server");
    return run(context.user.id, context.user.email, data);
  });

export const updateAccount = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string; name?: string; color?: string }) => ({
    id: requireId(input?.id),
    ...(input?.name !== undefined ? { name: input.name } : {}),
    ...(input?.color !== undefined ? { color: input.color } : {}),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    const { updateAccount: run } = await import("@/integrations/postgres/accounts.server");
    await run(context.user.id, data);
    return null;
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    const { deleteAccount: run } = await import("@/integrations/postgres/accounts.server");
    await run(context.user.id, data.id);
    return null;
  });

export const fetchMembers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) => {
    const { listMembers } = await import("@/integrations/postgres/accounts.server");
    return listMembers(context.user.id, data.accountId);
  });

export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string; role: AccountRole }) => ({
    id: requireId(input?.id),
    role: requireRole(input?.role),
  }))
  .handler(async ({ data, context }): Promise<null> => {
    const { updateMember: run } = await import("@/integrations/postgres/accounts.server");
    await run(context.user.id, data);
    return null;
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    const { removeMember: run } = await import("@/integrations/postgres/accounts.server");
    await run(context.user.id, data.id);
    return null;
  });

export const fetchInvites = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string }) => ({ accountId: requireId(input?.accountId) }))
  .handler(async ({ data, context }) => {
    const { listInvites } = await import("@/integrations/postgres/accounts.server");
    return listInvites(context.user.id, data.accountId);
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { accountId: string; email: string; role: "editor" | "viewer" }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido");
    if (input?.role !== "editor" && input?.role !== "viewer") throw new Error("Papel inválido");
    return { accountId: requireId(input?.accountId, "accountId"), email, role: input.role };
  })
  .handler(async ({ data, context }): Promise<string> => {
    const { inviteMember: run } = await import("@/integrations/postgres/accounts.server");
    return run(context.user.id, data.accountId, { email: data.email, role: data.role });
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: requireId(input?.id) }))
  .handler(async ({ data, context }): Promise<null> => {
    const { revokeInvite: run } = await import("@/integrations/postgres/accounts.server");
    await run(context.user.id, data.id);
    return null;
  });

export const previewInvite = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { token: string }) => ({ token: requireId(input?.token, "token") }))
  .handler(async ({ data }) => {
    const { previewInvite: run } = await import("@/integrations/postgres/accounts.server");
    return run(data.token);
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { token: string }) => ({ token: requireId(input?.token, "token") }))
  .handler(async ({ data, context }): Promise<string> => {
    const { acceptInvite: run } = await import("@/integrations/postgres/accounts.server");
    return run(context.user.id, context.user.email, data.token);
  });
