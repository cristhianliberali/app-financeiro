import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptInvite,
  createAccount,
  deleteAccount,
  fetchAccounts,
  fetchInvites,
  fetchMembers,
  inviteMember,
  previewInvite,
  removeMember as removeMemberFn,
  revokeInvite,
  updateAccount,
  updateMember as updateMemberFn,
  type AccountRole,
} from "./accounts.functions";

export type { AccountRole };

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

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => (await fetchAccounts()) as Account[],
  });
}

export function useAccountMembers(accountId: string | null) {
  return useQuery({
    queryKey: ["account-members", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountMember[]> =>
      (await fetchMembers({ data: { accountId: accountId! } })) as AccountMember[],
  });
}

export function useAccountInvites(accountId: string | null) {
  return useQuery({
    queryKey: ["account-invites", accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<AccountInvite[]> =>
      (await fetchInvites({ data: { accountId: accountId! } })) as AccountInvite[],
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: string }) =>
      (await createAccount({ data: input })) as Account,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; color?: string }) => {
      await updateAccount({ data: input });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await deleteAccount({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useInviteMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: "editor" | "viewer" }) =>
      inviteMember({ data: { accountId: accountId!, email: input.email, role: input.role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-invites", accountId] }),
  });
}

export function useRevokeInvite(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await revokeInvite({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-invites", accountId] }),
  });
}

export function useUpdateMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; role: AccountRole }) => {
      await updateMemberFn({ data: input });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-members", accountId] }),
  });
}

export function useRemoveMember(accountId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await removeMemberFn({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["account-members", accountId] }),
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => acceptInvite({ data: { token } }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ["invite-preview", token],
    enabled: !!token,
    queryFn: async () => {
      const row = await previewInvite({ data: { token: token! } });
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
