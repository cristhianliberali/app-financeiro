import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, LogOut, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { ACESSO_QUERY_KEY, useAcesso } from "@/hooks/usePlano";
import { MENSAGEM_BLOQUEIO, ROTULO_STATUS } from "@/lib/plano";

/**
 * A tela de quem está logado mas sem acesso.
 *
 * É a única tela do app que uma assinatura inativa alcança, e por isso ela
 * carrega três coisas: o motivo (que muda conforme o status), o caminho de
 * volta (o checkout) e a saída para quem quer entrar com outra conta.
 *
 * O "já paguei" existe porque o webhook não é instantâneo: quem volta do
 * checkout em dois segundos chega aqui antes de a Cakto avisar, e um botão que
 * reconsulta é mais honesto do que um F5 que a pessoa não sabe que precisa dar.
 */
export const Route = createFileRoute("/assinatura")({
  head: () => ({
    meta: [
      { title: "Assinatura — Aura Finanças" },
      { name: "description", content: "Estado da sua assinatura do Aura Finanças." },
    ],
  }),
  component: AssinaturaPage,
});

function AssinaturaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading, signOut } = useAuth();
  const { data: acesso, isFetching, refetch } = useAcesso(!!user);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <span className="size-9 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  const liberado = acesso?.liberado ?? false;
  const mensagem = acesso?.motivo ? MENSAGEM_BLOQUEIO[acesso.motivo] : null;

  async function conferir() {
    const { data } = await refetch();
    await qc.invalidateQueries({ queryKey: ACESSO_QUERY_KEY });
    if (data?.liberado) {
      toast.success("Assinatura confirmada. Bom proveito!");
      navigate({ to: "/" });
    } else {
      toast.info("Ainda não recebemos a confirmação do pagamento. Tente de novo em instantes.");
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-4 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span className="brand-gradient flex size-9 items-center justify-center rounded-xl shadow-glow">
            <Sparkles className="size-4" strokeWidth={2.5} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-lg font-extrabold tracking-tight">AURA</span>
            <span className="label-caps text-[0.6rem]">Finanças</span>
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-lg space-y-6 rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
          <div className="space-y-2">
            <p className="label-caps">Sua assinatura</p>
            <h1 className="text-2xl font-bold tracking-tight">
              {liberado ? "Tudo certo por aqui" : "Acesso pausado"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Conta: <span className="font-medium text-foreground">{user.email}</span>
            </p>
          </div>

          <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Situação</dt>
              <dd className="font-semibold">
                {acesso ? ROTULO_STATUS[acesso.status] : "Consultando…"}
              </dd>
            </div>
            {acesso?.codigoOferta && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Plano</dt>
                <dd className="truncate font-mono text-xs">{acesso.codigoOferta}</dd>
              </div>
            )}
            {acesso?.expiraEm && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{liberado ? "Renova em" : "Terminou em"}</dt>
                <dd className="font-medium">
                  {new Date(acesso.expiraEm).toLocaleDateString("pt-BR")}
                </dd>
              </div>
            )}
          </dl>

          {mensagem && (
            <p className="rounded-xl border border-primary/15 bg-primary-soft/40 p-4 text-sm leading-relaxed">
              {mensagem}
            </p>
          )}

          {/*
            Os dados continuam lá, e dizer isso importa: o medo de quem vê um
            app fechar não é perder o acesso, é perder o que já lançou.
          */}
          {!liberado && (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              Nada foi apagado. Seus lançamentos, categorias e tarefas voltam exatamente como
              estavam assim que a assinatura for reativada.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {liberado ? (
              <Button onClick={() => navigate({ to: "/" })}>
                Ir para o app <ArrowRight className="size-4" />
              </Button>
            ) : (
              <>
                {acesso?.checkoutUrl && (
                  <Button asChild>
                    <a href={acesso.checkoutUrl} target="_blank" rel="noreferrer">
                      Assinar agora <ArrowRight className="size-4" />
                    </a>
                  </Button>
                )}
                <Button variant="outline" onClick={conferir} disabled={isFetching}>
                  <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
                  Já paguei
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
            >
              <LogOut className="size-4" /> Sair
            </Button>
          </div>

          {!acesso?.caktoConfigurada && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              A integração de pagamento ainda não foi configurada neste servidor. Se você é quem
              administra o app, defina <code className="font-mono">CAKTO_WEBHOOK_SECRET</code> —
              veja <code className="font-mono">docs/cakto-assinaturas.md</code>.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
