import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ExternalLink, Plus, Sun, Sunrise, Sunset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAgendaEvents } from "@/lib/google";
import {
  useBoardStatuses,
  useBoards,
  useMoveTaskByPolarity,
  useSaveSubtask,
  useSaveTask,
  useSpaces,
  type Subtask,
  type Task,
} from "@/lib/tasks";
import { todayKey } from "@/lib/tasks-analytics";

/**
 * "Meu dia": o que precisa acontecer hoje, num lugar só.
 *
 * Junta as tarefas do app e os compromissos da agenda do dia, separados por
 * manhã, tarde e noite. Concluir aqui é o mesmo que concluir no quadro — a
 * tarefa vai para a etapa de polaridade "sucesso" do quadro dela, seja qual for
 * o nome que aquele quadro deu a essa etapa.
 */

type Period = "manha" | "tarde" | "noite";

const PERIODS: Array<{
  key: Period;
  label: string;
  icon: typeof Sunrise;
  from: number;
  to: number;
}> = [
  { key: "manha", label: "Manhã", icon: Sunrise, from: 0, to: 11 },
  { key: "tarde", label: "Tarde", icon: Sun, from: 12, to: 17 },
  { key: "noite", label: "Noite", icon: Sunset, from: 18, to: 23 },
];

/** Em que período do dia a hora cai. Sem horário definido, começa a manhã. */
function periodOf(iso: string | null): Period {
  if (!iso) return "manha";
  const hour = new Date(iso).getHours();
  return PERIODS.find((period) => hour >= period.from && hour <= period.to)?.key ?? "manha";
}

function isToday(iso: string | null, today: string): boolean {
  return !!iso && new Date(iso).toISOString().slice(0, 10) === today
    ? true
    : !!iso && localDay(iso) === today;
}

/** Dia local do timestamp — o usuário pensa no fuso dele, não em UTC. */
function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function hourLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (date.getHours() === 0 && date.getMinutes() === 0) return "—";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

type DayItem =
  | { kind: "task"; at: string | null; task: Task; subtasks: Subtask[] }
  | { kind: "event"; at: string; id: string; title: string; link?: string | undefined };

export function MyDay({
  tasks,
  currentUserId,
  accountId,
  onOpenTask,
}: {
  tasks: Task[];
  currentUserId: string | null;
  accountId: string | null;
  onOpenTask: (task: Task) => void;
}) {
  const today = todayKey();
  const { data: agenda = [] } = useAgendaEvents({ from: today, to: today });
  const complete = useMoveTaskByPolarity();
  const saveSubtask = useSaveSubtask();

  /** Só o que é meu: sou responsável ou participante. */
  const mine = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.responsible_user_id === currentUserId ||
          (currentUserId ? task.participants.includes(currentUserId) : false),
      ),
    [tasks, currentUserId],
  );

  const items = useMemo(() => {
    const list: DayItem[] = [];

    for (const task of mine) {
      const dueToday = isToday(task.due_date, today);
      const startsToday = isToday(task.start_date, today);
      // Subtarefas com data de hoje entram junto da tarefa-mãe.
      const subtasks = task.subtasks.filter(
        (subtask) => isToday(subtask.due_date, today) || isToday(subtask.start_date, today),
      );

      if (dueToday || startsToday || subtasks.length > 0) {
        list.push({
          kind: "task",
          at: dueToday ? task.due_date : (task.start_date ?? task.due_date),
          task,
          subtasks,
        });
      }
    }

    for (const event of agenda) {
      // Compromisso que nasceu de uma tarefa já aparece como tarefa.
      if (event.taskId && mine.some((task) => task.id === event.taskId)) continue;
      list.push({
        kind: "event",
        at: event.start,
        id: event.id,
        title: event.title,
        link: event.link,
      });
    }

    return list.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  }, [mine, agenda, today]);

  const done = items.filter(
    (item) => item.kind === "task" && item.task.status?.polarity === "SUCCESS",
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Meu dia</h2>
          <p className="text-xs text-muted-foreground">
            {items.length === 0
              ? "Nada marcado para hoje."
              : `${items.length} item(ns) hoje · ${done} concluído(s)`}
          </p>
        </div>
        <NewTaskShortcut accountId={accountId} />
      </div>

      {PERIODS.map((period) => {
        const ofPeriod = items.filter((item) => periodOf(item.at) === period.key);
        return (
          <div key={period.key} className="panel p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <period.icon className="size-4 text-muted-foreground" />
              {period.label}
              <span className="text-xs font-normal text-muted-foreground">({ofPeriod.length})</span>
            </h3>

            {ofPeriod.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nada por aqui.</p>
            ) : (
              <div className="space-y-1.5">
                {ofPeriod.map((item) =>
                  item.kind === "event" ? (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border border-dashed border-border p-2.5"
                    >
                      <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {hourLabel(item.at)}
                      </span>
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Abrir na agenda"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <div key={item.task.id} className="space-y-1">
                      <div className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-[var(--color-primary)]"
                          checked={item.task.status?.polarity === "SUCCESS"}
                          aria-label={`Concluir ${item.task.title}`}
                          onChange={async (e) => {
                            const result = await complete.mutateAsync({
                              id: item.task.id,
                              polarity: e.target.checked ? "SUCCESS" : "IN_PROGRESS",
                            });
                            toast.success(
                              result?.statusName
                                ? `Movida para "${result.statusName}"`
                                : "Tarefa atualizada",
                            );
                          }}
                        />
                        <button
                          onClick={() => onOpenTask(item.task)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span
                            className={`block truncate text-sm ${
                              item.task.status?.polarity === "SUCCESS"
                                ? "text-muted-foreground line-through"
                                : ""
                            }`}
                          >
                            {item.task.title}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {item.task.space.icon} {item.task.space.name} › {item.task.board.name}
                          </span>
                        </button>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {hourLabel(item.at)}
                        </span>
                      </div>

                      {item.subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="ml-6 flex items-center gap-3 rounded-lg border border-border/60 p-2"
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0 accent-[var(--color-primary)]"
                            checked={subtask.completed}
                            aria-label={`Concluir ${subtask.title}`}
                            onChange={(e) =>
                              saveSubtask.mutate({
                                id: subtask.id,
                                task_id: subtask.task_id,
                                completed: e.target.checked,
                              })
                            }
                          />
                          <span
                            className={`min-w-0 flex-1 truncate text-xs ${
                              subtask.completed ? "text-muted-foreground line-through" : ""
                            }`}
                          >
                            {subtask.title}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {hourLabel(subtask.due_date ?? subtask.start_date)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Atalho para criar tarefa sem sair do painel. Toda tarefa precisa de espaço,
 * quadro e etapa — os dois primeiros são escolhidos aqui, e a etapa é a padrão
 * do quadro. A data já nasce hoje, que é o sentido do painel.
 */
function NewTaskShortcut({ accountId }: { accountId: string | null }) {
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const saveTask = useSaveTask();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [boardId, setBoardId] = useState("");

  const activeSpaces = spaces.filter((space) => !space.archived_at);
  const spaceBoards = boards.filter(
    (board) => !board.archived_at && (!spaceId || board.space_id === spaceId),
  );
  const { data: statuses = [] } = useBoardStatuses(boardId || null);

  async function create() {
    const status = statuses.find((s) => s.is_default) ?? statuses[0];
    if (!boardId || !status) {
      toast.error("Escolha o espaço e o quadro onde a tarefa entra");
      return;
    }
    // Prazo hoje, ao fim do dia: é o que faz a tarefa aparecer no painel.
    const end = new Date();
    end.setHours(23, 59, 0, 0);

    await saveTask.mutateAsync({
      board_id: boardId,
      status_id: status.id,
      title: title.trim(),
      due_date: end.toISOString(),
    });
    toast.success("Tarefa criada para hoje");
    setTitle("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1 size-3.5" /> Nova tarefa para hoje
      </Button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-4">
          <Label htmlFor="meu-dia-titulo">Tarefa</Label>
          <Input
            id="meu-dia-titulo"
            autoFocus
            value={title}
            placeholder="O que precisa ser feito hoje?"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && title.trim() && void create()}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="meu-dia-espaco">Espaço</Label>
          <select
            id="meu-dia-espaco"
            value={spaceId}
            onChange={(e) => {
              setSpaceId(e.target.value);
              setBoardId("");
            }}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="">Escolha…</option>
            {activeSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.icon} {space.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="meu-dia-quadro">Quadro</Label>
          <select
            id="meu-dia-quadro"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="">Escolha…</option>
            {spaceBoards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2">
          <Button
            size="sm"
            onClick={() => void create()}
            disabled={!title.trim() || saveTask.isPending}
          >
            Criar para hoje
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </div>
      {boardId && statuses.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Este quadro ainda não tem etapas. Crie uma etapa no quadro antes.
        </p>
      )}
    </div>
  );
}
