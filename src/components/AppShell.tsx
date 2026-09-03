import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  TrendingUp,
  Target,
  Check,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  // "Conta & equipe" saiu daqui: é ajuste de cadastro, não navegação do dia, e
  // vive no menu do perfil, junto das outras preferências da pessoa.
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
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
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
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all motion-safe:hover:translate-x-0.5 ${
                active
                  ? "glow-soft bg-primary-soft text-primary-soft-foreground"
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
          <p className="label-caps mb-1.5">Subconta ativa</p>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: current?.color ?? "var(--color-primary)" }}
            />
            <span className="truncate">{current?.name ?? "—"}</span>
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Lançamentos, categorias e metas exibidos pertencem a esta subconta.
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
    // `min-h-dvh` e não `min-h-screen`: `vh` mede a janela sem a barra de
    // endereço do navegador móvel, então a tela vazia (ou quase) ficava sempre
    // alta demais e rolava alguns pixels sem ter o que mostrar.
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed left-0 top-0 z-10 hidden h-full w-64 flex-col border-r border-sidebar-border bg-sidebar p-5 lg:flex">
        {sidebar}
      </aside>

      {/*
        A largura da gaveta vem do primitivo (`min(20rem, 100vw - 3rem)`), e não
        de um `w-72` escrito aqui: num celular estreito o valor fixo encostava
        na borda oposta e não sobrava véu para tocar e fechar.
      */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="flex flex-col overflow-y-auto p-5 lg:hidden">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <main className="lg:pl-64">
        {/*
          Cabeçalho de uma linha só, também no celular.

          Ele era `flex-wrap` com seis controles dentro — dois seletores, o
          cronômetro, o sino e os botões da tela. Em 375px isso virava três
          fileiras de altura fixa, grudadas no topo: metade da janela era
          cabeçalho antes de a página começar. Aqui o celular fica com o que
          precisa estar sempre à mão (menu, contexto e avisos) e o resto desce
          para a barra de ações, que rola na horizontal.
        */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur-xl lg:h-16 lg:gap-3 lg:px-8">
          <button
            onClick={() => setMenuOpen(true)}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>

          {/*
            No celular, conta e subconta cabem num controle só.

            São duas escolhas do mesmo assunto — "de quem são os números desta
            tela" — e no desktop elas ficam lado a lado porque há largura para
            isso. No celular, dois botões de contexto ocupam a linha inteira e
            não sobra espaço para o nome de nenhum dos dois. Um botão, dois
            grupos dentro do menu.
          */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 text-left text-sm font-semibold shadow-xs transition-colors hover:border-border-strong hover:bg-accent lg:hidden">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: current?.color ?? "var(--color-primary)" }}
              />
              <span className="min-w-0 flex-1 truncate">{current?.name ?? "—"}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {(accounts?.length ?? 0) > 1 && (
                <>
                  <DropdownMenuLabel className="label-caps">Conta</DropdownMenuLabel>
                  {accounts?.map((a) => (
                    <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      {a.id === accountId && <Check className="size-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={() => navigate({ to: "/conta" })}>
                    <Plus className="size-4" /> Gerenciar contas
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="label-caps">Subconta</DropdownMenuLabel>
              {profiles?.map((pf) => (
                <DropdownMenuItem key={pf.id} onClick={() => setProfileId(pf.id)}>
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: pf.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{pf.name}</span>
                  {pf.id === profileId && <Check className="size-4 shrink-0 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            {/*
              O seletor de contas só existe quando há mais de uma.
              Depois da consolidação, cada pessoa tem uma conta própria e este
              nível deixa de ser uma escolha — mostrá-lo era pedir que alguém
              guardasse em qual de duas gavetas empilhadas uma despesa foi
              parar. Ele reaparece sozinho para quem foi convidado à conta de
              outra pessoa: ali a troca é real, e escondê-la esconderia dados.
            */}
            {(accounts?.length ?? 0) > 1 && (
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
            )}

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold shadow-xs transition-colors hover:border-border-strong hover:bg-accent">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: current?.color ?? "var(--color-primary)" }}
                />
                <span className="truncate">
                  <span className="font-normal text-muted-foreground">Subconta: </span>
                  {current?.name ?? "—"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {profiles?.map((pf) => (
                  <DropdownMenuItem key={pf.id} onClick={() => setProfileId(pf.id)}>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: pf.color }}
                    />
                    <span className="truncate">{pf.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
            <ActiveTimerBar />
            {/* Os lembretes de tarefa também alcançam quem está no Finanças. */}
            <NotificationBell />
            {/* No celular estes botões vivem na barra de ações, logo abaixo. */}
            <div className="hidden items-center gap-2 lg:flex">{actions}</div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4 lg:space-y-6 lg:p-8">
          {/*
            Barra de ações do celular.

            Uma fileira que rola na horizontal, e não uma grade que quebra em
            linhas: quatro botões empilhados em duas fileiras empurram o
            conteúdo da tela para baixo toda vez, enquanto a fileira que rola
            custa sempre a mesma altura. As margens negativas fazem a rolagem
            começar na borda da tela — um botão cortado ao meio na beirada é o
            que diz que há mais coisa para o lado.
          */}
          {actions && (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4 lg:hidden [&>*]:shrink-0">
              {actions}
            </div>
          )}
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
