import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/lib/app-state";
import { useAcceptInvite, useInvitePreview } from "@/lib/accounts";

type Search = { token?: string };

export const Route = createFileRoute("/convite")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Convite para uma conta — Aura Finanças" },
      {
        name: "description",
        content: "Aceite o convite e passe a acompanhar ou editar as finanças do grupo.",
      },
      { property: "og:title", content: "Convite para uma conta — Aura Finanças" },
      {
        property: "og:description",
        content: "Aceite o convite para entrar em um grupo de conta no Aura Finanças.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const { setAccountId } = useAppState();
  const { data: preview, isLoading } = useInvitePreview(session ? (token ?? null) : null);
  const accept = useAcceptInvite();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8">
        <h1 className="text-xl font-bold tracking-tight">Convite de conta</h1>

        {!token && <p className="text-sm text-muted-foreground">Link de convite inválido.</p>}

        {token && !loading && !session && (
          <>
            <p className="text-sm text-muted-foreground">
              Entre com a sua conta para aceitar o convite.
            </p>
            <Button className="w-full" onClick={() => navigate({ to: "/auth" })}>
              Entrar
            </Button>
          </>
        )}

        {token && session && isLoading && (
          <p className="text-sm text-muted-foreground">Carregando convite…</p>
        )}

        {token && session && !isLoading && !preview && (
          <p className="text-sm text-muted-foreground">Convite não encontrado.</p>
        )}

        {token && session && preview && (
          <>
            <p className="text-sm text-muted-foreground">
              Você foi convidado para a conta{" "}
              <span className="font-semibold text-foreground">{preview.account_name}</span> como{" "}
              <span className="font-semibold text-foreground">
                {preview.role === "editor" ? "editor" : "leitor"}
              </span>
              .
            </p>
            {preview.status !== "pending" ? (
              <p className="text-sm text-muted-foreground">Este convite já foi utilizado.</p>
            ) : (
              <Button
                className="w-full"
                disabled={accept.isPending}
                onClick={async () => {
                  try {
                    const accountId = await accept.mutateAsync(token);
                    setAccountId(accountId);
                    toast.success("Convite aceito");
                    navigate({ to: "/" });
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Aceitar convite
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
