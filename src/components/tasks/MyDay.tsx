import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Link2,
  Plus,
  Sun,
  Sunrise,
  Sunset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAgendaEvents, useGoogleStatus } from "@/lib/google";
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
import { dayKey, todayKey } from "@/lib/tasks-analytics";
import { parseISODate } from "@/lib/format";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";
import { useAgendaDone } from "./agenda-done";

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

/**
 * Há quanto tempo a tarefa venceu.
 *
 * Na lista de atrasadas a hora não diz nada — o que pesa é o tamanho do atraso,
 * e é isso que ordena a atenção de quem olha.
 */
function lateLabel(iso: string | null): string {
  const day = dayKey(iso);
  if (!day) return "—";
  const days = Math.round(
    (parseISODate(todayKey()).getTime() - parseISODate(day).getTime()) / 86400000,
  );
  if (days <= 0) return "hoje";
  return days === 1 ? "1 dia" : `${days} dias`;
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
  const { data: google } = useGoogleStatus();
  const { data: agenda = [] } = useAgendaEvents({ from: today, to: today });
  const complete = useMoveTaskByPolarity();
  const saveSubtask = useSaveSubtask();
  const agendaDone = useAgendaDone(today);

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

  /**
   * O que venceu antes de hoje e continua em aberto.
   *
   * Vem antes dos períodos de propósito: uma tarefa atrasada não cabe em manhã,
   * tarde ou noite — ela já passou —, e escondê-la abaixo do dia de hoje é
   * como não mostrá-la. As arquivadas ficam de fora: elas saíram do fluxo.
   */
  const late = useMemo(
    () =>
      mine
        .filter((task) => {
          const polarity = task.status?.polarity ?? null;
          if (polarity === "SUCCESS" || polarity === "ARCHIVED") return false;
          const due = dayKey(task.due_date);
          return !!due && due < today;
        })
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [mine, today],
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
      /*
       * A janela pedida ao servidor já é só hoje, mas o compromisso de vários
       * dias volta com o início lá atrás. Conferir a sobreposição aqui é o que
       * garante que "Meu dia" mostre exatamente o que cruza o dia de hoje —
       * inclusive o que começou ontem e termina agora.
       */
      if (localDay(event.start) > today || localDay(event.end) < today) continue;
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

  /** Concluir vale para os dois lados do painel: tarefa fechada e compromisso cumprido. */
  const done = items.filter((item) =>
    item.kind === "task" ? item.task.status?.polarity === "SUCCESS" : agendaDone.isDone(item.id),
  ).length;
  const agendaCount = items.filter((item) => item.kind === "event").length;

  /** Conclui a tarefa no quadro dela, seja qual for o nome da etapa de sucesso. */
  async function completeTask(task: Task, checked: boolean) {
    const result = await complete.mutateAsync({
      id: task.id,
      polarity: checked ? "SUCCESS" : "IN_PROGRESS",
    });
    toast.success(result?.statusName ? `Movida para “${result.statusName}”` : "Tarefa atualizada");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Meu dia</h2>
          <p className="text-xs text-muted-foreground">
            {items.length === 0
              ? "Nada marcado para hoje."
              : `${items.length} item(ns) hoje · ${done} concluído(s)`}
            {google?.connected && agendaCount > 0 && (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  {agendaCount} da agenda do Google
                </span>
              </>
            )}
          </p>
        </div>
        <NewTaskShortcut accountId={accountId} />
      </div>

      {/*
        Sem conta conectada, o dia mostra só as tarefas — e não há nada na tela
        que explique a ausência dos compromissos. Esta linha explica e leva ao
        lugar de conectar.
      */}
      {google?.configured && !google.connected && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5 shrink-0" />
          Conecte sua conta do Google em
          <a href="/conta" className="font-semibold text-primary hover:underline">
            Conta &amp; equipe
          </a>
          para ver aqui também os compromissos da agenda.
        </p>
      )}

      {/*
        Atrasadas, acima de tudo. Sem nenhuma, a ausência vira uma linha discreta
        em vez de um cartão vazio: dizer "está tudo em dia" é informação, ocupar
        um bloco inteiro para dizer isso não é.
      */}
      {late.length === 0 ? (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0 text-positive" />
          Você não possui tarefas atrasadas.
        </p>
      ) : (
        <div className="panel state-bar state-late p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-negative-soft text-negative-soft-foreground">
              <AlarmClock className="size-3.5" />
            </span>
            Atrasadas
            <span className="rounded-full bg-negative-soft px-2 py-0.5 font-mono text-[10px] font-bold text-negative-soft-foreground">
              {late.length}
            </span>
          </h3>
          <div className="space-y-1.5">
            {late.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                subtasks={[]}
                at={task.due_date}
                overdue
                onOpen={onOpenTask}
                onToggle={completeTask}
                onToggleSubtask={(subtask, checked) =>
                  saveSubtask.mutate({
                    id: subtask.id,
                    task_id: subtask.task_id,
                    completed: checked,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {PERIODS.map((period) => {
        const ofPeriod = items.filter((item) => periodOf(item.at) === period.key);
        return (
          <div key={period.key} className="panel p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <period.icon className="size-3.5" />
              </span>
              {period.label}
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                {ofPeriod.length}
              </span>
            </h3>

            {ofPeriod.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nada por aqui.</p>
            ) : (
              <div className="space-y-1.5">
                {ofPeriod.map((item) =>
                  item.kind === "event" ? (
                    <EventRow
                      key={item.id}
                      item={item}
                      done={agendaDone.isDone(item.id)}
                      onToggle={() => agendaDone.toggle(item.id, today)}
                    />
                  ) : (
                    <TaskRow
                      key={item.task.id}
                      task={item.task}
                      subtasks={item.subtasks}
                      at={item.at}
                      onOpen={onOpenTask}
                      onToggle={completeTask}
                      onToggleSubtask={(subtask, checked) =>
                        saveSubtask.mutate({
                          id: subtask.id,
                          task_id: subtask.task_id,
                          completed: checked,
                        })
                      }
                    />
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
 * Compromisso vindo da agenda conectada.
 *
 * A borda tracejada e o selo "Google Agenda" o separam das tarefas do app. A
 * caixa de marcar existe pelo mesmo motivo que existe na tarefa — fechar o dia
 * inteiro —, mas ela não sai daqui: nada é escrito de volta no Google.
 */
function EventRow({
  item,
  done,
  onToggle,
}: {
  item: Extract<DayItem, { kind: "event" }>;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`state-bar flex items-center gap-3 rounded-xl border border-dashed border-border p-2.5 transition-colors hover:bg-accent/40 ${
        done ? "state-done" : "state-due"
      }`}
    >
      <Checkbox
        className="shrink-0"
        checked={done}
        aria-label={`Marcar ${item.title} como cumprido`}
        title="Marca só aqui — nada é alterado na agenda do Google"
        onCheckedChange={onToggle}
      />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-soft-foreground">
        <CalendarClock className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${done ? "done-text" : ""}`}>
          {item.title}
        </span>
        <span className="label-caps text-[0.6rem]">Google Agenda</span>
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{hourLabel(item.at)}</span>
      {item.link && (
        <a
          href={item.link}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Abrir na agenda"
          title="Abrir na agenda do Google"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

/** Tarefa do app, com as subtarefas datadas logo abaixo dela. */
function TaskRow({
  task,
  subtasks,
  at,
  overdue = false,
  onOpen,
  onToggle,
  onToggleSubtask,
}: {
  task: Task;
  subtasks: Subtask[];
  at: string | null;
  /** Atrasada: o horário vira a data em que venceu, que é o que importa aqui. */
  overdue?: boolean;
  onOpen: (task: Task) => void;
  onToggle: (task: Task, checked: boolean) => Promise<void>;
  onToggleSubtask: (subtask: Subtask, checked: boolean) => void;
}) {
  const isDone = task.status?.polarity === "SUCCESS";
  return (
    <div className="space-y-1">
      <div
        className={`state-bar flex items-center gap-3 rounded-xl border border-border p-2.5 transition-colors hover:bg-accent/40 ${
          isDone ? "state-done" : overdue ? "state-late" : "state-pending"
        }`}
      >
        <Checkbox
          className="shrink-0"
          checked={isDone}
          aria-label={`Concluir ${task.title}`}
          onCheckedChange={(checked) => void onToggle(task, checked === true)}
        />
        <button onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
          <span className={`block truncate text-sm font-semibold ${isDone ? "done-text" : ""}`}>
            {task.title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <IconBadge
              name={task.space.icon}
              color={task.space.color}
              size="sm"
              fallback={DEFAULT_SPACE_ICON}
            />
            <span className="truncate">
              {task.space.name} › {task.board.name}
            </span>
          </span>
        </button>
        <span
          className={`font-mono text-[11px] ${overdue ? "text-negative" : "text-muted-foreground"}`}
        >
          {overdue ? lateLabel(at) : hourLabel(at)}
        </span>
      </div>

      {subtasks.map((subtask) => (
        <div
          key={subtask.id}
          className="ml-6 flex items-center gap-3 rounded-lg border border-border/60 bg-surface/60 p-2"
        >
          <Checkbox
            className="size-4 shrink-0"
            checked={subtask.completed}
            aria-label={`Concluir ${subtask.title}`}
            onCheckedChange={(checked) => onToggleSubtask(subtask, checked === true)}
          />
          <span
            className={`min-w-0 flex-1 truncate text-xs ${subtask.completed ? "done-text" : ""}`}
          >
            {subtask.title}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {hourLabel(subtask.due_date ?? subtask.start_date)}
          </span>
        </div>
      ))}
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
    <div className="panel w-full p-3">
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
