import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  TrendingUp,
  Target,
  Users,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/lib/app-state";
import { useProfiles } from "@/lib/data";
import { useAccounts } from "@/lib/accounts";
import { PeriodControls } from "@/components/PeriodControls";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActiveTimerBar } from "@/components/tasks/ActiveTimerBar";
import { NotificationBell } from "@/components/tasks/NotificationBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Casca do módulo Finanças. O módulo Projetos e Tarefas tem a sua própria
 * (`TasksShell`); a passagem entre os dois é o `ModuleSwitcher` aqui no topo.
 */
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/categorias", label: "Categorias", icon: Tags },
  { to: "/investimentos", label: "Investimentos", icon: TrendingUp },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/conta", label: "Conta & equipe", icon: Users },
] as const;

export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { accountId, setAccountId, profileId, setProfileId } = useAppState();
  const { data: accounts } = useAccounts();
  const { data: profiles } = useProfiles(accountId);

  useEffect(() => {
    if (accounts?.length && !accounts.some((a) => a.id === accountId)) {
      setAccountId(accounts[0]!.id);
    }
  }, [accounts, accountId, setAccountId]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (profiles?.length && !profiles.some((p) => p.id === profileId)) {
      setProfileId((profiles.find((p) => p.is_default) ?? profiles[0]!).id);
    }
  }, [profiles, profileId, setProfileId]);

  const current = profiles?.find((p) => p.id === profileId);
  const currentAccount = accounts?.find((a) => a.id === accountId);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed left-0 top-0 z-10 hidden h-full w-64 flex-col border-r border-border bg-card p-6 lg:flex">
        <div className="mb-6 flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary" />
          <span className="text-xl font-bold tracking-tight">AURA</span>
        </div>
        <div className="mb-6">
          <ModuleSwitcher />
        </div>
        <nav className="space-y-1">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="rounded-xl border border-border bg-secondary/50 p-4">
            <p className="label-caps mb-2">Perfil ativo</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Os lançamentos, categorias e metas exibidos pertencem ao perfil{" "}
              <span className="font-semibold text-foreground">{current?.name ?? "—"}</span>.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="size-4" /> Sair
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur-md lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: currentAccount?.color ?? "var(--foreground)" }}
                />
                {currentAccount?.name ?? "Conta"}
                <ChevronDown className="size-3 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {accounts?.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
                    <span
                      className="mr-2 size-2 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    {a.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {a.role === "owner" ? "dono" : a.role === "editor" ? "editor" : "leitor"}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => navigate({ to: "/conta" })}>
                  + Gerenciar contas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="hidden h-4 w-px bg-border sm:block" />
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: current?.color ?? "var(--foreground)" }}
                />
                Perfil: {current?.name ?? "—"}
                <ChevronDown className="size-3 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {profiles?.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => setProfileId(p.id)}>
                    <span
                      className="mr-2 size-2 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="hidden h-4 w-px bg-border sm:block" />
            <PeriodControls />
          </div>
          <div className="flex items-center gap-2">
            <ActiveTimerBar />
            {/* Os lembretes de tarefa também alcançam quem está no Finanças. */}
            <NotificationBell />
            {actions}
          </div>
        </header>
        <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
