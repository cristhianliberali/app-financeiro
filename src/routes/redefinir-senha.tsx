import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD } from "@/lib/auth.functions";
import {
  checkPasswordResetToken,
  getMailConfig,
  requestPasswordReset,
  resetPassword,
} from "@/lib/profile.functions";

type Search = { token?: string | undefined };

export const Route = createFileRoute("/redefinir-senha")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Redefinir senha — Aura Finanças" },
      {
        name: "description",
        content: "Receba um link por e-mail e escolha uma nova senha para entrar na sua conta.",
      },
      { property: "og:title", content: "Redefinir senha — Aura Finanças" },
      {
        property: "og:description",
        content: "Recupere o acesso à sua conta do Aura Finanças.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

/**
 * Duas telas no mesmo caminho: sem `?token=` é o pedido do link; com token é a
 * escolha da nova senha. O link do e-mail chega direto no segundo caso.
 */
function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();

  const { data: mail } = useQuery({
    queryKey: ["mail-config"],
    queryFn: () => getMailConfig(),
    staleTime: 5 * 60 * 1000,
  });
  const mailEnabled = mail?.enabled ?? false;

  const { data: check, isPending: checking } = useQuery({
    queryKey: ["password-reset-token", token],
    enabled: !!token,
    retry: false,
    queryFn: () => checkPasswordResetToken({ data: { token: token! } }),
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSent(false);
  }, [token]);

  async function askLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset({ data: { email } });
      setSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o e-mail");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) {
      toast.error("As senhas não conferem");
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ data: { token: token!, password } });
      toast.success("Senha redefinida. Entre com a nova senha.");
      navigate({ to: "/auth" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível redefinir a senha");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary" />
          <span className="text-xl font-bold tracking-tight">AURA</span>
        </div>

        {!token ? (
          <>
            <h1 className="title-xl">Redefinir senha</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Informe o e-mail da sua conta e enviaremos um link para escolher uma nova senha.
            </p>

            {!mailEnabled && (
              <p className="mt-4 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                O envio de e-mail ainda não foi configurado neste servidor (variáveis SMTP_*).
                Procure quem administra o app.
              </p>
            )}

            {sent ? (
              <div className="mt-8 space-y-4">
                <p className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
                  Se existir uma conta com esse e-mail, o link de redefinição já está a caminho. Ele
                  vale por 60 minutos.
                </p>
                <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                  Enviar de novo
                </Button>
              </div>
            ) : (
              <form onSubmit={askLink} className="mt-8 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email">E-mail</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || !mailEnabled}>
                  Enviar link de redefinição
                </Button>
              </form>
            )}
          </>
        ) : checking ? (
          <p className="text-sm text-muted-foreground">Conferindo o link…</p>
        ) : check?.valid ? (
          <>
            <h1 className="title-xl">Escolha uma nova senha</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Depois de salvar, as sessões abertas em outros dispositivos são encerradas.
            </p>
            <form onSubmit={save} className="mt-8 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">Nova senha</Label>
                <Input
                  id="reset-password"
                  type="password"
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use pelo menos {MIN_PASSWORD} caracteres.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-confirmation">Repita a nova senha</Label>
                <Input
                  id="reset-confirmation"
                  type="password"
                  required
                  minLength={MIN_PASSWORD}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Salvar nova senha
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="title-xl">Link expirado</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Este link de redefinição não vale mais — ele expira em 60 minutos e só pode ser usado
              uma vez.
            </p>
            <Button
              className="mt-6 w-full"
              onClick={() => navigate({ to: "/redefinir-senha", search: {} })}
            >
              Pedir um novo link
            </Button>
          </>
        )}

        <Link
          to="/auth"
          className="mt-6 block w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Voltar para a entrada
        </Link>
      </div>
    </div>
  );
}
