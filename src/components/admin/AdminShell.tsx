import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeft, LogOut, Radio, ShieldAlert, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { souSuperAdmin } from "@/lib/admin.functions";

export const SUPER_ADMIN_QUERY_KEY = ["admin", "sou-super-admin"] as const;

const NAV = [
  { to: "/admin", label: "Usuários", icon: Users, exact: true },
  { to: "/admin/eventos", label: "Eventos da Cakto", icon: Radio, exact: false },
] as const;

/**
 * Casca do painel de super admin.
 *
 * Tem entrada própria — um formulário de login aqui dentro — em vez de mandar
 * para `/auth`: quem administra costuma chegar por link direto, e passar pela
 * porta comum do app para depois ser redirecionado de volta é um desvio sem
 * motivo. É o mesmo login e a mesma sessão; o que muda é só onde o formulário
 * aparece.
 *
 * O que decide se a pessoa entra é o servidor (`souSuperAdmin`), consultado a
 * cada carga da tela. Nada aqui protege dado nenhum sozinho: cada função do
 * painel refaz a checagem por conta própria.
 */
export function AdminShell({ children, titulo }: { children: ReactNode; titulo: string }) {
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: autorizado, isPending: verificando } = useQuery({
    queryKey: SUPER_ADMIN_QUERY_KEY,
    queryFn: () => souSuperAdmin(),
    enabled: !!user,
    retry: false,
  });

  if (loading || (user && verificando)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <span className="size-9 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (!user) return <LoginAdmin />;
  if (!autorizado) return <SemAcesso />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
              <ShieldAlert className="size-4" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="label-caps text-[0.6rem]">Super admin</p>
              <p className="truncate text-sm font-bold">{titulo}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="size-4" /> Voltar ao app
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-4 pb-2 lg:px-8">
          {NAV.map((item) => {
            const ativo = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  ativo
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">{children}</main>
    </div>
  );
}

function LoginAdmin() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    try {
      await signIn(email, senha);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <form
        onSubmit={entrar}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8"
      >
        <div className="space-y-1.5">
          <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <ShieldAlert className="size-5" strokeWidth={2.5} />
          </span>
          <h1 className="text-xl font-bold tracking-tight">Painel do super admin</h1>
          <p className="text-sm text-muted-foreground">
            Entre com a conta que administra o Aura Finanças.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="admin-email">E-mail</Label>
          <Input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="admin-senha">Senha</Label>
          <Input
            id="admin-senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}

function SemAcesso() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 text-center shadow-xs">
        <h1 className="text-xl font-bold tracking-tight">Área restrita</h1>
        <p className="text-sm text-muted-foreground">
          A conta <span className="font-medium text-foreground">{user?.email}</span> não tem
          permissão de super admin.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            <ArrowLeft className="size-4" /> Voltar ao app
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut();
            }}
          >
            <LogOut className="size-4" /> Entrar com outra conta
          </Button>
        </div>
      </div>
    </div>
  );
}
