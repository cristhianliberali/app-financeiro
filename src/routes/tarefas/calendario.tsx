import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { TasksShell } from "@/components/tasks/TasksShell";
import { TaskCalendar } from "@/components/tasks/TaskCalendar";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoardStatuses, useBoards, useSpaces, useTasks, type Task } from "@/lib/tasks";
import { useAgendaEvents, useGoogleStatus } from "@/lib/google";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/tarefas/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário — Projetos e Tarefas" },
      {
        name: "description",
        content:
          "Tarefas e subtarefas com datas em visualização mensal, semanal ou diária, de todos os quadros.",
      },
    ],
  }),
  component: CalendarPage,
});

const SELECT_CLASS =
  "h-10 rounded-xl border border-input bg-card px-2.5 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

function CalendarPage() {
  const { accountId, users, currentUserId } = useTasksModule();
  const { data: allTasks = [] } = useTasks({ accountId });
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const [spaceId, setSpaceId] = useState("");
  const [boardId, setBoardId] = useState("");
  const [responsible, setResponsible] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  const { data: statuses = [] } = useBoardStatuses(selected?.board_id ?? null);

  /*
   * Quem conectou a agenda quer vê-la junto das tarefas — é o ponto de ter
   * conectado. Por isso o filtro nasce ligado; desmarcar é para quando a
   * agenda pessoal atrapalha a leitura do trabalho.
   */
  const [showAgenda, setShowAgenda] = useState(true);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { data: google } = useGoogleStatus();
  const { data: agenda = [] } = useAgendaEvents(google?.connected && showAgenda ? range : null);

  // Estável entre renderizações: o calendário reporta a janela num efeito, e uma
  // função nova a cada render o faria reportar em laço.
  const handleRange = useCallback(
    (next: { from: string; to: string }) =>
      setRange((current) =>
        current?.from === next.from && current.to === next.to ? current : next,
      ),
    [],
  );

  const tasks = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          (!spaceId || t.space.id === spaceId) &&
          (!boardId || t.board_id === boardId) &&
          (!responsible || t.responsible_user_id === responsible),
      ),
    [allTasks, spaceId, boardId, responsible],
  );

  const openTask = selected ? (allTasks.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <TasksShell breadcrumbCurrent="Calendário">
      <div>
        <h1 className="title-xl">Calendário</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tarefas e subtarefas com datas definidas, de todos os espaços e quadros a que você tem
          acesso.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className={SELECT_CLASS}
          value={spaceId}
          onChange={(e) => {
            setSpaceId(e.target.value);
            setBoardId("");
          }}
        >
          <option value="">Todos os espaços</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={boardId}
          onChange={(e) => setBoardId(e.target.value)}
        >
          <option value="">Todos os quadros</option>
          {boards
            .filter((b) => !spaceId || b.space_id === spaceId)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
        >
          <option value="">Todos os responsáveis</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {google?.configured &&
        (google.connected ? (
          <label className="flex w-fit cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium shadow-xs transition-colors hover:border-border-strong">
            <Checkbox
              checked={showAgenda}
              onCheckedChange={(checked) => setShowAgenda(checked === true)}
              aria-label="Mostrar compromissos do Google Agenda"
            />
            <CalendarClock className="size-4 text-warning-soft-foreground" />
            Mostrar compromissos do Google Agenda
            {showAgenda && agenda.length > 0 && (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 font-mono text-[10px] font-bold text-warning-soft-foreground">
                {agenda.length}
              </span>
            )}
          </label>
        ) : (
          <p className="flex w-fit items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" />
            Conecte sua conta do Google em
            <a href="/conta" className="font-semibold text-primary hover:underline">
              Conta &amp; equipe
            </a>
            para ver os compromissos da agenda aqui.
          </p>
        ))}

      <TaskCalendar
        tasks={tasks}
        users={users}
        agenda={agenda}
        onOpen={setSelected}
        onRangeChange={handleRange}
      />

      {openTask && (
        <TaskDialog
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
          task={openTask}
          boardId={openTask.board_id}
          statuses={statuses}
          users={users}
          currentUserId={currentUserId}
        />
      )}
    </TasksShell>
  );
}
