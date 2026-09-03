import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Plus, Trash2, UserPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/lib/app-state";
import { siteUrl } from "@/lib/site-url";
import { useProfiles, useUpsert, useRemove } from "@/lib/data";
import {
  useAccountInvites,
  useAccountMembers,
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useInviteMember,
  useRemoveMember,
  useRevokeInvite,
  useUpdateAccount,
  useUpdateMember,
  type AccountRole,
} from "@/lib/accounts";

export const Route = createFileRoute("/conta")({
  head: () => ({
    meta: [
      { title: "Conta e equipe — Aura Finanças" },
      {
        name: "description",
        content:
          "Gerencie suas contas, convide pessoas para o grupo, defina quem pode ver ou editar e organize os perfis que isolam os dados.",
      },
      { property: "og:title", content: "Conta e equipe — Aura Finanças" },
      {
        property: "og:description",
        content: "Grupo de conta, permissões de acesso e múltiplos perfis financeiros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountPage,
});

const roleLabel: Record<AccountRole, string> = {
  owner: "Dono",
  editor: "Editor",
  viewer: "Leitor",
};

function AccountPage() {
  const { user } = useAuth();
  const { accountId, setAccountId } = useAppState();
  const { data: accounts } = useAccounts();
  const account = accounts?.find((a) => a.id === accountId) ?? null;
  const isOwner = account?.role === "owner";
  const canEdit = account?.role === "owner" || account?.role === "editor";

  const { data: members } = useAccountMembers(isOwner ? accountId : accountId);
  const { data: invites } = useAccountInvites(isOwner ? accountId : null);
  const { data: profiles } = useProfiles(accountId);

  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const invite = useInviteMember(accountId);
  const revokeInvite = useRevokeInvite(accountId);
  const updateMember = useUpdateMember(accountId);
  const removeMember = useRemoveMember(accountId);
  const upsertProfile = useUpsert("budget_profiles");
  const removeProfile = useRemove("budget_profiles");

  const [name, setName] = useState("");
  const [newAccount, setNewAccount] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [profileName, setProfileName] = useState("");
  const [profileColor, setProfileColor] = useState("#3B82F6");
  // Exclusões que levam tudo junto pedem o nome digitado antes de acontecer.
  const [deletingAccount, setDeletingAccount] = useState<{ id: string; name: string } | null>(null);
  const [deletingProfile, setDeletingProfile] = useState<{ id: string; name: string } | null>(null);

  const displayName = useMemo(() => name || account?.name || "", [name, account]);

  const inviteLink = (token: string) => siteUrl(`/convite?token=${token}`);

  return (
    <AppShell>
      <header>
        <h1 className="title-xl">Conta e equipe</h1>
        <p className="text-sm text-muted-foreground">
          Cada conta é um espaço independente. Dentro dela você cria perfis (Pessoal, Empresa,
          Família…) que isolam totalmente os dados, e convida pessoas para ver ou editar.
        </p>
      </header>

      {/* Contas */}
      <section className="panel p-6">
        <h2 className="label-caps mb-4">Minhas contas</h2>
        <div className="space-y-2">
          {accounts?.map((a) => (
            <div
              key={a.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                a.id === accountId ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <span className="size-3 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="font-medium">{a.name}</span>
              <Badge variant="secondary">{roleLabel[a.role]}</Badge>
              <div className="ml-auto flex gap-2">
                {a.id !== accountId && (
                  <Button size="sm" variant="outline" onClick={() => setAccountId(a.id)}>
                    Ativar
                  </Button>
                )}
                {a.role === "owner" && accounts.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeletingAccount({ id: a.id, name: a.name })}
                    aria-label={`Excluir a conta ${a.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="new-account">Nova conta</Label>
            <Input
              id="new-account"
              value={newAccount}
              placeholder="Ex.: Família Liberali"
              onChange={(e) => setNewAccount(e.target.value)}
              className="w-64"
            />
          </div>
          <Button
            onClick={async () => {
              if (!newAccount.trim()) return;
              const created = await createAccount.mutateAsync({
                name: newAccount.trim(),
                color: "#10B981",
              });
              setNewAccount("");
              setAccountId(created.id);
              toast.success("Conta criada");
            }}
          >
            <Plus className="mr-1 size-4" /> Criar conta
          </Button>
        </div>
      </section>

      {/* Dados da conta ativa */}
      {account && (
        <section className="panel p-6">
          <h2 className="label-caps mb-4">Conta ativa</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="account-name">Nome</Label>
              <Input
                id="account-name"
                value={displayName}
                disabled={!isOwner}
                onChange={(e) => setName(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="account-color">Cor</Label>
              <Input
                id="account-color"
                type="color"
                value={account.color}
                disabled={!isOwner}
                onChange={(e) => updateAccount.mutate({ id: account.id, color: e.target.value })}
                className="h-10 w-16 p-1"
              />
            </div>
            {isOwner && (
              <Button
                variant="outline"
                onClick={async () => {
                  await updateAccount.mutateAsync({ id: account.id, name: displayName });
                  setName("");
                  toast.success("Conta atualizada");
                }}
              >
                Salvar
              </Button>
            )}
          </div>
          {!isOwner && (
            <p className="mt-3 text-xs text-muted-foreground">
              Você participa desta conta como {roleLabel[account.role].toLowerCase()}. Só o dono
              pode alterar dados da conta e gerenciar membros.
            </p>
          )}
        </section>
      )}

      {/* Subcontas financeiras */}
      <section className="panel p-6">
        <h2 className="label-caps mb-1">Subcontas financeiras</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Cada subconta tem transações, categorias, investimentos e metas totalmente isolados. É a
          única divisão do dinheiro: acima dela existe só a sua conta de e-mail.
        </p>
        <div className="space-y-2">
          {profiles?.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent/40"
            >
              <span className="size-3 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="font-medium">{p.name}</span>
              {p.is_default && <Badge variant="secondary">padrão</Badge>}
              {canEdit && (profiles?.length ?? 0) > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setDeletingProfile({ id: p.id, name: p.name })}
                  aria-label={`Excluir a subconta ${p.name}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">Nova subconta</Label>
              <Input
                id="profile-name"
                value={profileName}
                placeholder="Ex.: Família"
                onChange={(e) => setProfileName(e.target.value)}
                className="w-64"
              />
            </div>
            <Input
              type="color"
              value={profileColor}
              onChange={(e) => setProfileColor(e.target.value)}
              className="h-10 w-16 p-1"
              aria-label="Cor da subconta"
            />
            <Button
              variant="outline"
              onClick={async () => {
                if (!profileName.trim() || !accountId) return;
                await upsertProfile.mutateAsync({
                  account_id: accountId,
                  name: profileName.trim(),
                  color: profileColor,
                  is_default: false,
                });
                setProfileName("");
                toast.success("Subconta criada");
              }}
            >
              <Plus className="mr-1 size-4" /> Adicionar subconta
            </Button>
          </div>
        )}
      </section>

      {/* Membros */}
      <section className="panel p-6">
        <h2 className="label-caps mb-4">Membros do grupo</h2>
        <div className="space-y-2">
          {members?.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent/40"
            >
              <span className="text-sm font-medium">
                {m.user_id === user?.id ? "Você" : (m.email ?? m.user_id.slice(0, 8))}
              </span>
              {m.role === "owner" || !isOwner ? (
                <Badge variant="secondary">{roleLabel[m.role]}</Badge>
              ) : (
                <Select
                  value={m.role}
                  onValueChange={(v) => updateMember.mutate({ id: m.id, role: v as AccountRole })}
                >
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Leitor</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {isOwner && m.role !== "owner" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={async () => {
                    await removeMember.mutateAsync(m.id);
                    toast.success("Membro removido");
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Convidar por e-mail</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                placeholder="pessoa@email.com"
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-64"
              />
            </div>
            <Select
              value={inviteRole}
              onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}
            >
              <SelectTrigger className="h-10 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Pode ver</SelectItem>
                <SelectItem value="editor">Pode editar</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={async () => {
                if (!inviteEmail.trim()) return;
                try {
                  const token = await invite.mutateAsync({
                    email: inviteEmail,
                    role: inviteRole,
                  });
                  await navigator.clipboard.writeText(inviteLink(token)).catch(() => {});
                  setInviteEmail("");
                  toast.success("Convite criado — link copiado para a área de transferência");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <UserPlus className="mr-1 size-4" /> Convidar
            </Button>
          </div>
        )}
      </section>

      {/* Convites */}
      {isOwner && (invites?.length ?? 0) > 0 && (
        <section className="panel p-6">
          <h2 className="label-caps mb-4">Convites</h2>
          <div className="space-y-2">
            {invites?.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent/40"
              >
                <span className="text-sm font-medium">{i.email}</span>
                <Badge variant="secondary">
                  {i.role === "editor" ? "Pode editar" : "Pode ver"}
                </Badge>
                <Badge variant={i.status === "pending" ? "outline" : "secondary"}>
                  {i.status === "pending"
                    ? "pendente"
                    : i.status === "accepted"
                      ? "aceito"
                      : "revogado"}
                </Badge>
                <div className="ml-auto flex gap-2">
                  {i.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(inviteLink(i.token));
                        toast.success("Link copiado");
                      }}
                    >
                      <Copy className="mr-1 size-4" /> Link
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await revokeInvite.mutateAsync(i.id);
                      toast.success("Convite removido");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDeleteDialog
        open={deletingAccount !== null}
        onOpenChange={(value) => !value && setDeletingAccount(null)}
        itemLabel="conta"
        itemName={deletingAccount?.name ?? ""}
        description={
          <>
            A conta <span className="font-semibold text-foreground">{deletingAccount?.name}</span> e
            tudo que existe dentro dela some para todo mundo que participa. Não há como desfazer.
          </>
        }
        consequences={[
          "Todos os perfis desta conta, com transações, categorias, investimentos e metas",
          "Todos os espaços, quadros, tarefas, subtarefas, anexos e apontamentos de tempo",
          "Os membros e os convites pendentes perdem o acesso na hora",
        ]}
        confirmLabel="Excluir conta"
        onConfirm={async () => {
          await deleteAccount.mutateAsync(deletingAccount!.id);
          setDeletingAccount(null);
          toast.success("Conta excluída");
        }}
      />

      <ConfirmDeleteDialog
        open={deletingProfile !== null}
        onOpenChange={(value) => !value && setDeletingProfile(null)}
        itemLabel="subconta"
        itemName={deletingProfile?.name ?? ""}
        description={
          <>
            A subconta{" "}
            <span className="font-semibold text-foreground">{deletingProfile?.name}</span> e todos
            os dados financeiros dele somem. Os outros perfis da conta não são afetados.
          </>
        }
        consequences={[
          "Todos os lançamentos da subconta, incluindo os já conciliados",
          "As categorias e os tetos de orçamento definidos nele",
          "Os investimentos, as metas e as regras de recorrência da subconta",
        ]}
        confirmLabel="Excluir subconta"
        onConfirm={async () => {
          await removeProfile.mutateAsync(deletingProfile!.id);
          setDeletingProfile(null);
          toast.success("Subconta excluída");
        }}
      />
    </AppShell>
  );
}
