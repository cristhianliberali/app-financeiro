import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AccountRole = "owner" | "editor" | "viewer";

export type Account = {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  role: AccountRole;
};

export type AccountMember = {
  id: string;
  user_id: string;
  role: AccountRole;
  email: string | null;
  created_at: string;
};

export type AccountInvite = {
  id: string;
  email: string;
  role: Exclude<AccountRole, "owner">;
  token: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  created_at: string;
};

async function currentUser() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sessão expirada");
  return data.user;
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const user = await currentUser();
      const { data, error } = await supabase
        .from("account_members")
        .select("role, accounts(id,name,color,owner_id)")
        .order("created_at");
      if (error) throw error;

      const rows = (data ?? [])
        .filter((m) => m.accounts)
        .map((m) => ({
          ...(m.accounts as { id: string; name: string; color: string; owner_id: string }),
          role: m.role as AccountRole,
        }));
      if (rows.length > 0) return rows;

      const { data: created, error: e2 } = await supabase
        .from("accounts")
        .insert({ owner_id: user.id, name: "Minha conta", color: "#3B82F6" })
        .select("id,name,color,owner_id")
        .single();
      if (e2) throw e2;
      return [{ ...created, role: "owner" as const }];
    },
  });
}

export function useAccountMembers(accountId: string | null) {
  return useQuery({
    queryKey: ["account-members", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountMember[]> => {
      const { data, error } = await supabase
        .from("account_members")
        .select("id,user_id,role,email,created_at")
        .eq("account_id", accountId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as AccountMember[];
    },
  });
}

export function useAccountInvites(accountId: string | null) {
  return useQuery({
    queryKey: ["account-invites", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountInvite[]> => {
      const { data, error } = await supabase
        .from("account_invites")
        .select("id,email,role,token,status,expires_at,created_at")
        .eq("account_id", accountId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountInvite[];
    },
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: string }) => {
      const user = await currentUser();
      const { data, error } = await supabase
        .from("accounts")
        .insert({ owner_id: user.id, name: input.name, color: input.color })
        .select("id,name,color,owner_id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; color?: string }) => {
      const { id, ...rest } = input;
      const { error } = await supabase.from("accounts").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useInviteMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: "editor" | "viewer" }) => {
      const user = await currentUser();
      const { data, error } = await supabase
        .from("account_invites")
        .insert({
          account_id: accountId!,
          email: input.email.trim().toLowerCase(),
          role: input.role,
          invited_by: user.id,
        })
        .select("token")
        .single();
      if (error) throw error;
      return data.token as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-invites", accountId] }),
  });
}

export function useRevokeInvite(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("account_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-invites", accountId] }),
  });
}

export function useUpdateMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; role: AccountRole }) => {
      const { error } = await supabase
        .from("account_members")
        .update({ role: input.role })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-members", accountId] }),
  });
}

export function useRemoveMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("account_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-members", accountId] }),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("accept_account_invite", { _token: token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ["invite-preview", token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("invite_preview", { _token: token! });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as {
        account_name: string;
        role: AccountRole;
        email: string;
        expires_at: string;
        status: string;
      } | null;
    },
  });
}
