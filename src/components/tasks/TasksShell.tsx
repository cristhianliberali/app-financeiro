import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LogOut,
  MoreVertical,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTone } from "@/hooks/use-tone";
import { useAppState } from "@/lib/app-state";
import { useAccounts } from "@/lib/accounts";
import {
  useBoards,
  useDeleteBoard,
  useDeleteSpace,
  useSpaces,
  useTasks,
  type Board,
  type Space,
} from "@/lib/tasks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModuleSwitcher } from "@/components/ModuleSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ActiveTimerBar } from "./ActiveTimerBar";
import { BoardDialog } from "./BoardDialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { NotificationBell } from "./NotificationBell";
import { SpaceDialog } from "./SpaceDialog";
import { TasksBreadcrumb } from "./TasksBreadcrumb";

const SIDEBAR_STORAGE_KEY = "aura.tasks.sidebarCollapsed";
const EXPANDED_STORAGE_KEY = "aura.tasks.expandedSpaces";

const NAV = [
  { to: "/tarefas", label: "Visão geral", icon: LayoutDashboard, exact: true },
  { to: "/tarefas/minhas", label: "Minhas tarefas", icon: UserCheck, exact: false },
  { to: "/tarefas/calendario", label: "Calendário", icon: CalendarDays, exact: false },
  { to: "/tarefas/espacos", label: "Espaços", icon: Layers, exact: false },
] as const;

/**
 * Casca do módulo Projetos e Tarefas.
 *
 * É uma tela própria, separada da casca do Finanças (`AppShell`): menu lateral
 * recolhível com a árvore de espaços e quadros, cabeçalho com o caminho
 * hierárquico e os controles do módulo. A troca entre os dois módulos acontece
 * pelo `ModuleSwitcher`, no topo da lateral.
 */
export function TasksShell({
  children,
  /** Botões da tela atual, no canto direito do cabeçalho. */
  actions,
  spaceId = null,
  boardId = null,
  /** Último nível do caminho quando a tela não é um espaço/quadro. */
  breadcrumbCurrent,
}: {
  children: ReactNode;
  actions?: ReactNode;
  spaceId?: string | null;
  boardId?: string | null;
  breadcrumbCurrent?: string;
}) {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { accountId, setAccountId } = useAppState();
  const { data: accounts } = useAccounts();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const { data: tasks = [] } = useTasks({ accountId });
  const deleteSpace = useDeleteSpace();
  const deleteBoard = useDeleteBoard();
  const tone = useTone();

  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [spaceDialog, setSpaceDialog] = useState<{ open: boolean; space: Space | null }>({
    open: false,
    space: null,
  });
  const [boardDialog, setBoardDialog] = useState<{
    open: boolean;
    board: Board | null;
    spaceId: string | null;
  }>({ open: false, board: null, spaceId: null });
  const [confirmSpace, setConfirmSpace] = useState<Space | null>(null);
  const [confirmBoard, setConfirmBoard] = useState<Board | null>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1");
    try {
      const saved = JSON.parse(localStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) setExpanded(saved.filter((id) => typeof id === "string"));
    } catch {
      // Preferência corrompida não deve impedir a tela de abrir.
    }
  }, []);

  // O espaço da tela atual abre sozinho, para o item ativo estar sempre à vista.
  useEffect(() => {
    if (spaceId) setExpanded((list) => (list.includes(spaceId) ? list : [...list, spaceId]));
  }, [spaceId]);

  useEffect(() => {
    if (accounts?.length && !accounts.some((a) => a.id === accountId)) {
      setAccountId(accounts[0]!.id);
    }
  }, [accounts, accountId, setAccountId]);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  function toggleSidebar() {
    setCollapsed((value) => {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "0" : "1");
      return !value;
    });
  }

  function toggleSpace(id: string) {
    setExpanded((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const openTasksBySpace = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (task.status?.polarity !== "IN_PROGRESS") continue;
      map.set(task.space.id, (map.get(task.space.id) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const openTasksByBoard = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (task.status?.polarity !== "IN_PROGRESS") continue;
      map.set(task.board_id, (map.get(task.board_id) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const currentAccount = accounts?.find((a) => a.id === accountId);
  const activeSpaces = spaces.filter((s) => !s.archived_at);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={`hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex ${
          collapsed ? "w-16" : "w-72"
        }`}
      >
        <div
          className={`flex items-center gap-2 border-b border-sidebar-border p-3 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {!collapsed && (
            <Link to="/tarefas" className="flex min-w-0 items-center gap-2">
              <div className="size-7 shrink-0 rounded-lg bg-primary" />
              <span className="truncate text-base font-bold tracking-tight">AURA</span>
            </Link>
          )}
          <button
            onClick={toggleSidebar}
            className={`rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${
              collapsed ? "" : "ml-auto"
            }`}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            <PanelLeft className="size-4" />
          </button>
        </div>

        <div className="p-2">
          <ModuleSwitcher collapsed={collapsed} />
        </div>

        <nav className="space-y-0.5 border-b border-sidebar-border px-2 pb-3">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  collapsed ? "justify-center" : ""
                } ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                }`}
              >
                <item.icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto px-2 py-3 thin-scrollbar">
          {collapsed ? (
            <div className="space-y-1">
              {activeSpaces.map((space) => (
                <Link
                  key={space.id}
                  to="/tarefas/espacos/$spaceId"
                  params={{ spaceId: space.id }}
                  title={space.name}
                  className={`flex size-10 items-center justify-center rounded-lg text-base transition-colors ${
                    space.id === spaceId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                  }`}
                >
                  <span aria-hidden>{space.icon}</span>
                  <span className="sr-only">{space.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between px-2">
                <span className="label-caps">Espaços e quadros</span>
                <button
                  onClick={() => setSpaceDialog({ open: true, space: null })}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Novo espaço"
                  title="Novo espaço"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>

              <div className="space-y-0.5">
                {activeSpaces.map((space) => {
                  const spaceBoards = boards.filter(
                    (b) => b.space_id === space.id && !b.archived_at,
                  );
                  const isOpen = expanded.includes(space.id);
                  const isActive = space.id === spaceId && !boardId;
                  const pending = openTasksBySpace.get(space.id) ?? 0;

                  return (
                    <div key={space.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "hover:bg-sidebar-accent/60"
                        }`}
                      >
                        <button
                          onClick={() => toggleSpace(space.id)}
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={isOpen ? `Recolher ${space.name}` : `Expandir ${space.name}`}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                        <Link
                          to="/tarefas/espacos/$spaceId"
                          params={{ spaceId: space.id }}
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
                        >
                          <span aria-hidden>{space.icon}</span>
                          <span className={`truncate ${isActive ? "font-medium" : ""}`}>
                            {space.name}
                          </span>
                        </Link>
                        {pending > 0 && (
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground group-hover:hidden">
                            {pending}
                          </span>
                        )}
                        <div className="hidden shrink-0 items-center group-hover:flex">
                          <button
                            onClick={() =>
                              setBoardDialog({ open: true, board: null, spaceId: space.id })
                            }
                            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={`Novo quadro em ${space.name}`}
                            title="Novo quadro"
                          >
                            <Plus className="size-3" />
                          </button>
                          <ItemMenu
                            label={`Opções do espaço ${space.name}`}
                            onEdit={() => setSpaceDialog({ open: true, space })}
                            onDelete={() => setConfirmSpace(space)}
                            editLabel="Editar espaço"
                            deleteLabel="Excluir espaço"
                          />
                        </div>
                      </div>

                      {isOpen && (
                        <div className="ml-4 space-y-0.5 border-l border-sidebar-border pl-2">
                          {spaceBoards.map((board) => {
                            const boardActive = board.id === boardId;
                            const boardPending = openTasksByBoard.get(board.id) ?? 0;
                            return (
                              <div
                                key={board.id}
                                className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                                  boardActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "hover:bg-sidebar-accent/60"
                                }`}
                              >
                                <Link
                                  to="/tarefas/quadros/$boardId"
                                  params={{ boardId: board.id }}
                                  search={{}}
                                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs"
                                >
                                  <span
                                    className="size-2 shrink-0 rounded-full ring-1 ring-border"
                                    style={{ backgroundColor: tone(board.color) }}
                                  />
                                  <span
                                    className={`truncate ${boardActive ? "font-medium" : "text-muted-foreground"}`}
                                  >
                                    {board.name}
                                  </span>
                                </Link>
                                {boardPending > 0 && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground group-hover:hidden">
                                    {boardPending}
                                  </span>
                                )}
                                <div className="hidden shrink-0 group-hover:block">
                                  <ItemMenu
                                    label={`Opções do quadro ${board.name}`}
                                    onEdit={() =>
                                      setBoardDialog({
                                        open: true,
                                        board,
                                        spaceId: board.space_id,
                                      })
                                    }
                                    onDelete={() => setConfirmBoard(board)}
                                    editLabel="Editar quadro"
                                    deleteLabel="Excluir quadro"
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {spaceBoards.length === 0 && (
                            <button
                              onClick={() =>
                                setBoardDialog({ open: true, board: null, spaceId: space.id })
                              }
                              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <Plus className="size-3" /> Criar quadro
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {activeSpaces.length === 0 && (
                  <button
                    onClick={() => setSpaceDialog({ open: true, space: null })}
                    className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Plus className="size-3.5" /> Criar primeiro espaço
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div
          className={`space-y-2 border-t border-sidebar-border p-2 ${collapsed ? "flex flex-col items-center" : ""}`}
        >
          {collapsed ? (
            <ThemeToggle compact />
          ) : (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={user.email}>
                {user.email}
              </span>
              <ThemeToggle />
            </div>
          )}
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth" });
            }}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${
              collapsed ? "justify-center" : "w-full"
            }`}
            title="Sair"
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && "Sair"}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-2 backdrop-blur-md lg:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="lg:hidden">
              <ModuleSwitcher orientation="horizontal" />
            </div>
            <TasksBreadcrumb
              spaceId={spaceId}
              boardId={boardId}
              {...(breadcrumbCurrent ? { current: breadcrumbCurrent } : {})}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ActiveTimerBar />
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: currentAccount?.color ?? "var(--foreground)" }}
                />
                <span className="max-w-32 truncate">{currentAccount?.name ?? "Conta"}</span>
                <ChevronDown className="size-3 opacity-50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {accounts?.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
                    <span
                      className="mr-2 size-2 rounded-full"
                      style={{ backgroundColor: a.color }}
                    />
                    {a.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/conta" })}>
                  Gerenciar contas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <NotificationBell />
            {actions}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="mx-auto max-w-[1600px] space-y-6 p-4 lg:p-6">{children}</div>
        </div>
      </main>

      <SpaceDialog
        open={spaceDialog.open}
        onOpenChange={(open) => setSpaceDialog({ open, space: open ? spaceDialog.space : null })}
        accountId={accountId}
        space={spaceDialog.space}
        onCreated={(id) => navigate({ to: "/tarefas/espacos/$spaceId", params: { spaceId: id } })}
      />

      <BoardDialog
        open={boardDialog.open}
        onOpenChange={(open) =>
          setBoardDialog({
            open,
            board: open ? boardDialog.board : null,
            spaceId: open ? boardDialog.spaceId : null,
          })
        }
        spaces={spaces}
        defaultSpaceId={boardDialog.spaceId}
        board={boardDialog.board}
        onCreated={(id) =>
          navigate({ to: "/tarefas/quadros/$boardId", params: { boardId: id }, search: {} })
        }
      />

      <ConfirmDeleteDialog
        open={!!confirmSpace}
        onOpenChange={(open) => !open && setConfirmSpace(null)}
        itemLabel="espaço"
        itemName={confirmSpace?.name ?? ""}
        consequences={
          confirmSpace
            ? [
                `${boards.filter((b) => b.space_id === confirmSpace.id).length} quadro(s) deste espaço`,
                `${tasks.filter((t) => t.space.id === confirmSpace.id).length} tarefa(s), com subtarefas, comentários e tempo registrado`,
              ]
            : []
        }
        onConfirm={async () => {
          const removed = confirmSpace!;
          await deleteSpace.mutateAsync(removed.id);
          toast.success(`Espaço “${removed.name}” excluído`);
          setConfirmSpace(null);
          if (removed.id === spaceId) navigate({ to: "/tarefas/espacos" });
        }}
      />

      <ConfirmDeleteDialog
        open={!!confirmBoard}
        onOpenChange={(open) => !open && setConfirmBoard(null)}
        itemLabel="quadro"
        itemName={confirmBoard?.name ?? ""}
        consequences={
          confirmBoard
            ? [
                `${tasks.filter((t) => t.board_id === confirmBoard.id).length} tarefa(s) do quadro`,
                "Status personalizados, subtarefas e todo o tempo registrado",
              ]
            : []
        }
        onConfirm={async () => {
          const removed = confirmBoard!;
          await deleteBoard.mutateAsync(removed.id);
          toast.success(`Quadro “${removed.name}” excluído`);
          setConfirmBoard(null);
          if (removed.id === boardId) {
            navigate({ to: "/tarefas/espacos/$spaceId", params: { spaceId: removed.space_id } });
          }
        }}
      />
    </div>
  );
}

/** Menu de contexto (editar / excluir) dos itens da árvore lateral. */
function ItemMenu({
  label,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: {
  label: string;
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={label}
      >
        <MoreVertical className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 size-3.5" /> {editLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 size-3.5" /> {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
