import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { Button } from "@/components/ui/button";
import { BoardDialog } from "@/components/tasks/BoardDialog";
import { SpaceDialog } from "@/components/tasks/SpaceDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useTone } from "@/hooks/use-tone";
import { useBoards, useSpaces, useTasks, type Board } from "@/lib/tasks";
import { BOARD_STAGES, formatDateTimeBR } from "@/lib/tasks-analytics";
import { UserAvatar } from "@/components/tasks/UserPicker";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";

export const Route = createFileRoute("/tarefas/espacos/$spaceId")({
  head: () => ({
    meta: [
      { title: "Quadros do espaço — Projetos e Tarefas" },
      {
        name: "description",
        content: "Quadros do espaço: projetos, processos e fluxos de trabalho com suas tarefas.",
      },
    ],
  }),
  component: SpacePage,
});

function SpacePage() {
  const { spaceId } = Route.useParams();
  const navigate = useNavigate();
  const { accountId, users } = useTasksModule();
  const tone = useTone();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId, spaceId });
  const { data: tasks = [] } = useTasks({ accountId });

  const [boardDialog, setBoardDialog] = useState<{ open: boolean; board: Board | null }>({
    open: false,
    board: null,
  });
  const [spaceDialog, setSpaceDialog] = useState(false);

  const space = spaces.find((s) => s.id === spaceId) ?? null;

  return (
    <TasksShell
      spaceId={spaceId}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => setSpaceDialog(true)}>
            <Pencil className="mr-1 size-3.5" /> Editar espaço
          </Button>
          <Button size="sm" onClick={() => setBoardDialog({ open: true, board: null })}>
            <Plus className="mr-1 size-3.5" /> Novo quadro
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <IconBadge
          name={space?.icon}
          color={space?.color}
          size="lg"
          fallback={DEFAULT_SPACE_ICON}
        />
        <div>
          <h1 className="title-xl">{space?.name ?? "Espaço"}</h1>
          {space?.description && (
            <p className="text-sm text-muted-foreground">{space.description}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {boards.map((board) => {
          const boardTasks = tasks.filter((t) => t.board_id === board.id);
          const done = boardTasks.filter((t) => t.status?.polarity === "SUCCESS").length;
          const pct = boardTasks.length ? Math.round((done / boardTasks.length) * 100) : 0;
          const stage = BOARD_STAGES.find((s) => s.value === board.status)?.label ?? "";
          return (
            <div
              key={board.id}
              className="group relative rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <button
                onClick={() => setBoardDialog({ open: true, board })}
                className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                aria-label={`Editar ${board.name}`}
              >
                <Pencil className="size-3.5" />
              </button>
              <Link to="/tarefas/quadros/$boardId" params={{ boardId: board.id }} className="block">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: tone(board.color) }}
                  />
                  <p className="font-semibold">{board.name}</p>
                </div>
                {board.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {board.description}
                  </p>
                )}
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-positive" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {done}/{boardTasks.length} concluídas · {stage}
                  </span>
                  {board.owner_id && (
                    <UserAvatar
                      user={users.find((u) => u.user_id === board.owner_id) ?? null}
                      size={20}
                    />
                  )}
                </div>
                {(board.start_date || board.due_date) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {board.start_date && `Início ${formatDateTimeBR(board.start_date, false)}`}
                    {board.due_date && ` · Previsão ${formatDateTimeBR(board.due_date, false)}`}
                  </p>
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {boards.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum quadro neste espaço. Um quadro representa um projeto, processo ou fluxo de
            trabalho.
          </p>
          <Button className="mt-4" onClick={() => setBoardDialog({ open: true, board: null })}>
            <Plus className="mr-1 size-3.5" /> Criar quadro
          </Button>
        </div>
      )}

      <BoardDialog
        open={boardDialog.open}
        onOpenChange={(open) => setBoardDialog({ open, board: open ? boardDialog.board : null })}
        spaces={spaces}
        defaultSpaceId={spaceId}
        board={boardDialog.board}
        onCreated={(boardId) =>
          navigate({ to: "/tarefas/quadros/$boardId", params: { boardId }, search: {} })
        }
      />

      <SpaceDialog
        open={spaceDialog}
        onOpenChange={setSpaceDialog}
        accountId={accountId}
        space={space}
      />
    </TasksShell>
  );
}
