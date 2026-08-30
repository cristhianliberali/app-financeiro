import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, KeyRound, Mail, MailCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AUTH_QUERY_KEY, useAuth } from "@/hooks/useAuth";
import { MIN_PASSWORD, changePassword } from "@/lib/auth.functions";
import { useConnectGoogle, useDisconnectGoogle, useGoogleStatus } from "@/lib/google";
import {
  cancelEmailChange,
  confirmEmailChange,
  getMailConfig,
  getPendingEmailChange,
  requestEmailChange,
  requestPasswordReset,
  updateProfileName,
} from "@/lib/profile.functions";

/**
 * Preferências da pessoa logada: nome, e-mail e senha.
 *
 * A troca de e-mail é em duas etapas — o código vai para o endereço novo, e o
 * acesso só se move depois que ele volta digitado aqui. Sem SMTP configurado no
 * servidor, este passo (e o link de redefinição) aparecem desabilitados, com o
 * aviso do que falta, em vez de falharem no clique.
 */
export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: mail } = useQuery({
    queryKey: ["mail-config"],
    queryFn: () => getMailConfig(),
    staleTime: 5 * 60 * 1000,
  });
  const mailEnabled = mail?.enabled ?? false;

  const { data: pending } = useQuery({
    queryKey: ["email-change"],
    enabled: open,
    queryFn: () => getPendingEmailChange(),
  });

  const { data: google } = useGoogleStatus();
  const connectGoogle = useConnectGoogle();
  const disconnectGoogle = useDisconnectGoogle();

  const [name, setName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState<null | "name" | "email" | "code" | "password" | "reset">(null);

  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? "");
    setNewEmail("");
    setCode("");
    setCurrentPassword("");
    setNewPassword("");
    setBusy(null);
  }, [open, user]);

  /** Roda a ação mostrando o erro do servidor como está — ele já é explicativo. */
  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meu perfil</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Nome */}
          <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <User className="size-4" /> Dados pessoais
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Nome</Label>
              <Input
                id="profile-name"
                value={name}
                placeholder="Como você quer ser chamado"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={busy !== null || name.trim() === (user?.name ?? "").trim()}
              onClick={() =>
                run("name", async () => {
                  const updated = await updateProfileName({ data: { name } });
                  qc.setQueryData(AUTH_QUERY_KEY, updated);
                  toast.success("Nome atualizado");
                })
              }
            >
              Salvar nome
            </Button>
          </section>

          {/* E-mail */}
          <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="size-4" /> E-mail de acesso
            </h3>
            <p className="text-xs text-muted-foreground">
              Atual: <span className="font-medium text-foreground">{user?.email}</span>
            </p>

            {!mailEnabled && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Envio de e-mail não configurado no servidor (variáveis SMTP_*). A troca de e-mail e
                o link de redefinição de senha ficam indisponíveis até isso ser configurado.
              </p>
            )}

            {pending ? (
              <div className="space-y-3">
                <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
                  <MailCheck className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Enviamos um código de 6 dígitos para{" "}
                    <span className="font-semibold">{pending.newEmail}</span>. Ele vale por cerca de{" "}
                    {pending.expiresInMinutes} minuto(s).
                  </span>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-code">Código de confirmação</Label>
                  <Input
                    id="profile-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    className="font-mono tracking-[0.4em]"
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy !== null || code.length !== 6}
                    onClick={() =>
                      run("code", async () => {
                        const updated = await confirmEmailChange({ data: { code } });
                        qc.setQueryData(AUTH_QUERY_KEY, updated);
                        await qc.invalidateQueries({ queryKey: ["email-change"] });
                        await qc.invalidateQueries({ queryKey: ["account-members"] });
                        setCode("");
                        toast.success(`E-mail alterado para ${updated.email}`);
                      })
                    }
                  >
                    Confirmar novo e-mail
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      run("email", async () => {
                        await cancelEmailChange();
                        await qc.invalidateQueries({ queryKey: ["email-change"] });
                        setCode("");
                        toast.success("Troca de e-mail cancelada");
                      })
                    }
                  >
                    Cancelar troca
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-email">Novo e-mail</Label>
                  <Input
                    id="profile-email"
                    type="email"
                    autoComplete="email"
                    placeholder="novo@email.com"
                    value={newEmail}
                    disabled={!mailEnabled}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy !== null || !mailEnabled || !newEmail.trim()}
                  onClick={() =>
                    run("email", async () => {
                      const result = await requestEmailChange({ data: { email: newEmail } });
                      await qc.invalidateQueries({ queryKey: ["email-change"] });
                      setNewEmail("");
                      toast.success(`Código enviado para ${result.newEmail}`);
                    })
                  }
                >
                  Enviar código de confirmação
                </Button>
              </div>
            )}
          </section>

          {/* Google Agenda */}
          <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4" /> Google Agenda
            </h3>

            {google && !google.configured ? (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />A integração não está
                configurada neste servidor (variáveis GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).
              </p>
            ) : google?.connected ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Conectado como <span className="font-medium text-foreground">{google.email}</span>
                  {google.lastSyncAt && (
                    <>
                      {" "}
                      · última sincronização {new Date(google.lastSyncAt).toLocaleString("pt-BR")}
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  As tarefas em que você é responsável viram compromissos na sua agenda. Apagar o
                  compromisso lá limpa as datas da tarefa aqui — a tarefa em si não é excluída.
                </p>
                {google.lastError && (
                  <p className="flex items-start gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-negative" />
                    Última sincronização falhou: {google.lastError}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disconnectGoogle.isPending}
                  onClick={async () => {
                    await disconnectGoogle.mutateAsync();
                    toast.success("Google Agenda desconectado");
                  }}
                >
                  Desconectar
                </Button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Conecte para que as tarefas em que você é responsável apareçam na sua agenda, com
                  as datas sempre iguais nos dois lados.
                </p>
                <Button
                  size="sm"
                  disabled={connectGoogle.isPending}
                  onClick={() => connectGoogle.mutate()}
                >
                  Conectar Google Agenda
                </Button>
              </>
            )}
          </section>

          {/* Senha */}
          <section className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" /> Senha
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-current-password">Senha atual</Label>
                <Input
                  id="profile-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-new-password">Nova senha</Label>
                <Input
                  id="profile-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Use pelo menos {MIN_PASSWORD} caracteres. Trocar a senha encerra as sessões abertas em
              outros dispositivos.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy !== null || !currentPassword || newPassword.length < MIN_PASSWORD}
                onClick={() =>
                  run("password", async () => {
                    await changePassword({ data: { currentPassword, newPassword } });
                    setCurrentPassword("");
                    setNewPassword("");
                    toast.success("Senha alterada");
                  })
                }
              >
                Alterar senha
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null || !mailEnabled || !user?.email}
                title={mailEnabled ? undefined : "Configure o SMTP no servidor para enviar o link"}
                onClick={() =>
                  run("reset", async () => {
                    await requestPasswordReset({ data: { email: user!.email } });
                    toast.success(`Link de redefinição enviado para ${user!.email}`);
                  })
                }
              >
                Esqueci a senha — enviar link
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
