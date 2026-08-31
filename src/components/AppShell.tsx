import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  TrendingUp,
  Target,
  Users,
  ChevronDown,
  Clock3,
  Menu,
  Plus,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/lib/app-state";
import { useProfiles } from "@/lib/data";
import { useAccounts } from "@/lib/accounts";
import { PeriodBar } from "@/components/PeriodBar";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActiveTimerBar } from "@/components/tasks/ActiveTimerBar";
import { NotificationBell } from "@/components/tasks/NotificationBell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/**
 * Casca do módulo Finanças. O módulo Projetos e Tarefas tem a sua própria
 * (`TasksShell`); a passagem entre os dois é o `ModuleSwitcher` aqui no topo.
 */
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/pendentes", label: "Transações pendentes", icon: Clock3 },
  { to: "/categorias", label: "Categorias", icon: Tags },
  { to: "/investimentos", label: "Investimentos", icon: TrendingUp },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/conta", label: "Conta & equipe", icon: Users },
] as const;

export function AppShell({
  children,
  actions,
  /**
   * A barra de período comanda quase todas as telas do módulo, mas não todas:
   * a de pendências fala de vencimento, não de recorte de tempo, e mostrar um
   * controle que não muda nada seria pior do que não mostrá-lo.
   */
  showPeriodBar = true,
}: {
  children: ReactNode;
  actions?: ReactNode;
  showPeriodBar?: boolean;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { accountId, setAccountId, profileId, setProfileId } = useAppState();
  const { data: accounts } = useAccounts();
  const { data: profiles } = useProfiles(accountId);
  const [menuOpen, setMenuOpen] = useState(false);

  // Trocar de tela fecha o menu do celular — ele cobre a tela inteira.
  useEffect(() => setMenuOpen(false), [pathname]);

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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <span className="size-9 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  /**
   * Conteúdo da lateral. Vai para a coluna fixa no desktop e para a gaveta do
   * celular — a mesma navegação nos dois, sem duplicar o menu em dois lugares.
   */
  const sidebar = (
    <>
      <div className="mb-6 flex items-center gap-2.5">
        <span className="brand-gradient flex size-9 items-center justify-center rounded-xl shadow-glow">
          <Sparkles className="size-4" strokeWidth={2.5} />
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-lg font-extrabold tracking-tight">AURA</span>
          <span className="label-caps text-[0.6rem]">Finanças</span>
        </span>
      </div>
      <div className="mb-6">
        <ModuleSwitcher />
      </div>
      <nav className="space-y-0.5">
        <p className="label-caps mb-2 px-3">Navegação</p>
        {nav.map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                active
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {/* Marca do item ativo: um traço da marca colado na borda. */}
              <span
                className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
              <item.icon
                className={`size-4 shrink-0 transition-colors ${active ? "text-primary" : ""}`}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 pt-6">
        <div className="brand-sheen rounded-xl border border-primary/15 p-3.5">
          <p className="label-caps mb-1.5">Perfil ativo</p>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: current?.color ?? "var(--color-primary)" }}
            />
            <span className="truncate">{current?.name ?? "—"}</span>
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Lançamentos, categorias e metas exibidos pertencem a este perfil.
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <ProfileMenu />
          <div className="shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed left-0 top-0 z-10 hidden h-full w-64 flex-col border-r border-sidebar-border bg-sidebar p-5 lg:flex">
        {sidebar}
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex w-72 flex-col overflow-y-auto p-5 lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-xl lg:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => setMenuOpen(true)}
              className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="size-4" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold shadow-xs transition-colors hover:border-border-strong hover:bg-accent">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: currentAccount?.color ?? "var(--color-primary)" }}
                />
                <span className="max-w-28 truncate sm:max-w-none">
                  {currentAccount?.name ?? "Conta"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                {accounts?.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="label-caps text-[0.6rem]">
                      {a.role === "owner" ? "dono" : a.role === "editor" ? "editor" : "leitor"}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => navigate({ to: "/conta" })}>
                  <Plus className="size-4" /> Gerenciar contas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold shadow-xs transition-colors hover:border-border-strong hover:bg-accent">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: current?.color ?? "var(--color-primary)" }}
                />
                <span className="max-w-28 truncate sm:max-w-none">
                  <span className="hidden font-normal text-muted-foreground sm:inline">
                    Perfil:{" "}
                  </span>
                  {current?.name ?? "—"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {profiles?.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => setProfileId(p.id)}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-2">
            <ActiveTimerBar />
            {/* Os lembretes de tarefa também alcançam quem está no Finanças. */}
            <NotificationBell />
            {actions}
          </div>
        </header>
        <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
          {/*
            O recorte de período comanda tudo o que as telas de Finanças
            mostram, então ele abre o conteúdo em largura total, em vez de
            disputar espaço com os seletores de conta e perfil no cabeçalho.
          */}
          {showPeriodBar && <PeriodBar />}
          {children}
        </div>
      </main>
    </div>
  );
}
