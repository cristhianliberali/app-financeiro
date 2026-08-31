import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Clock, Pause, Play, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PaginationBar, usePagination } from "@/components/PaginationBar";
import { useNow } from "@/hooks/use-now";
import { useTone } from "@/hooks/use-tone";
import { useAppState } from "@/lib/app-state";
import { useLabels, type AccountUser, type Task } from "@/lib/tasks";
import {
  DEADLINE_LABEL,
  PRIORITIES,
  deadlineClass,
  deadlineState,
  estimateClass,
  estimateState,
  formatClock,
  formatDuration,
  formatDateTimeBR,
  formatHours,
  priorityOf,
} from "@/lib/tasks-analytics";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";
import { LabelChip, LabelFilter } from "./LabelPicker";
import { PriorityBadge } from "./PriorityPicker";
import { UserAvatar, UserStack } from "./UserPicker";

type SortKey = "title" | "status" | "priority" | "responsible" | "start" | "due" | "tracked";
type GroupKey = "none" | "status" | "priority" | "responsible" | "board" | "space";

const SELECT_CLASS =
  "h-10 rounded-xl border border-input bg-card px-2.5 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

export function TaskListView({
  tasks,
  users,
  currentUserId,
  onOpen,
  onToggleTimer,
  showBoard = false,
}: {
  tasks: Task[];
  users: AccountUser[];
  currentUserId: string | null;
  onOpen: (task: Task) => void;
  onToggleTimer: (task: Task) => void;
  showBoard?: boolean;
}) {
  const now = useNow(30_000);
  const tone = useTone();
  const { accountId } = useAppState();
  const { data: labels = [] } = useLabels(accountId);
  const [term, setTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "due", asc: true });
  const [group, setGroup] = useState<GroupKey>("none");

  const statusNames = useMemo(
    () => [...new Set(tasks.map((t) => t.status?.name).filter(Boolean) as string[])].sort(),
    [tasks],
  );

  const secondsOf = (task: Task) =>
    task.trackedSeconds +
    (task.running ? Math.floor((now - new Date(task.running.started_at).getTime()) / 1000) : 0);

  const nameOf = (id: string | null) =>
    id ? (users.find((u) => u.user_id === id)?.name ?? "Usuário") : "Sem responsável";

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return tasks.filter((task) => {
      // A busca cobre título e etiquetas — é como se procura "tudo do cliente X".
      if (
        t &&
        !task.title.toLowerCase().includes(t) &&
        !task.labels.some((label) => label.name.toLowerCase().includes(t))
      ) {
        return false;
      }
      if (statusFilter && task.status?.name !== statusFilter) return false;
      if (priorityFilter && task.priority !== priorityFilter) return false;
      if (responsibleFilter && (task.responsible_user_id ?? "") !== responsibleFilter) return false;
      // Etiquetas somam: a tarefa precisa ter todas as escolhidas.
      if (
        labelFilter.length > 0 &&
        !labelFilter.every((id) => task.labels.some((label) => label.id === id))
      ) {
        return false;
      }
      if (
        deadlineFilter &&
        deadlineState({ due_date: task.due_date, polarity: task.status?.polarity ?? null }) !==
          deadlineFilter
      )
        return false;
      return true;
    });
  }, [tasks, term, statusFilter, priorityFilter, responsibleFilter, deadlineFilter, labelFilter]);

  const sorted = useMemo(() => {
    const dir = sort.asc ? 1 : -1;
    const value = (task: Task) => {
      switch (sort.key) {
        case "title":
          return task.title.toLowerCase();
        case "status":
          return `${task.status?.sort_order ?? 99}${task.status?.name ?? ""}`;
        case "priority":
          // Invertido para que "crescente" traga o mais urgente no topo.
          return String(9 - priorityOf(task.priority).weight);
        case "responsible":
          return nameOf(task.responsible_user_id).toLowerCase();
        case "start":
          return task.start_date ?? "9999";
        case "due":
          return task.due_date ?? "9999";
        case "tracked":
          return String(secondsOf(task)).padStart(10, "0");
      }
    };
    return [...filtered].sort((a, b) =>
      value(a) < value(b) ? -dir : value(a) > value(b) ? dir : 0,
    );
  }, [filtered, sort, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pagina a lista já ordenada e só então agrupa: o agrupamento é da página
  // exibida, e a contagem do rodapé bate com o total filtrado.
  const pagination = usePagination(sorted, "aura.tarefas.lista.pageSize");

  const groups = useMemo(() => {
    const page = pagination.visible;
    if (group === "none") return [{ key: "", label: "", items: page }];
    const map = new Map<string, Task[]>();
    for (const task of page) {
      const label =
        group === "status"
          ? (task.status?.name ?? "Sem status")
          : group === "priority"
            ? priorityOf(task.priority).label
            : group === "responsible"
              ? nameOf(task.responsible_user_id)
              : group === "board"
                ? task.board.name
                : task.space.name;
      map.set(label, [...(map.get(label) ?? []), task]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, items]) => ({ key: label, label, items }));
  }, [pagination.visible, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (key: SortKey, label: string, className = "") => (
    <th className={`label-caps px-3 py-3 text-left ${className}`}>
      <button
        className="inline-flex items-center gap-1 transition-colors hover:text-primary"
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
      >
        {label}
        {sort.key === key &&
          (sort.asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Pesquisar tarefas…"
            className="pl-8"
          />
        </div>
        <select
          className={SELECT_CLASS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos os status</option>
          {statusNames.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">Todas as prioridades</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <LabelFilter labels={labels} value={labelFilter} onChange={setLabelFilter} />
        <select
          className={SELECT_CLASS}
          value={responsibleFilter}
          onChange={(e) => setResponsibleFilter(e.target.value)}
        >
          <option value="">Todos os responsáveis</option>
          {users.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={deadlineFilter}
          onChange={(e) => setDeadlineFilter(e.target.value)}
        >
          <option value="">Todos os prazos</option>
          {(["on_track", "due_today", "late", "done", "archived", "none"] as const).map((k) => (
            <option key={k} value={k}>
              {DEADLINE_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={group}
          onChange={(e) => setGroup(e.target.value as GroupKey)}
        >
          <option value="none">Sem agrupamento</option>
          <option value="status">Agrupar por status</option>
          <option value="priority">Agrupar por prioridade</option>
          <option value="responsible">Agrupar por responsável</option>
          <option value="board">Agrupar por quadro</option>
          <option value="space">Agrupar por espaço</option>
        </select>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] text-sm">
            <thead className="border-b border-border bg-surface text-xs text-muted-foreground">
              <tr>
                {header("title", "Tarefa")}
                {header("status", "Status")}
                {header("priority", "Prioridade")}
                {header("responsible", "Responsável")}
                {header("start", "Início")}
                {header("due", "Prazo")}
                {header("tracked", "Tempo / estimativa")}
                <th className="px-3 py-2 text-left font-medium">Participantes</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={`grp-${g.key}`}>
                  {g.label && (
                    <tr className="bg-surface-2">
                      <td colSpan={9} className="label-caps px-3 py-2">
                        {g.label} · {g.items.length}
                      </td>
                    </tr>
                  )}
                  {g.items.map((task) => {
                    const state = deadlineState({
                      due_date: task.due_date,
                      polarity: task.status?.polarity ?? null,
                    });
                    const seconds = secondsOf(task);
                    const isMine = task.running?.user_id === currentUserId;
                    return (
                      <tr
                        key={task.id}
                        className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-accent/40"
                        onClick={() => onOpen(task)}
                      >
                        {/* A borda esquerda repete o estado do prazo, como no
                            cartão do Kanban e nas linhas de Finanças. */}
                        <td
                          className={`border-l-[3px] px-3 py-2.5 ${
                            state === "done"
                              ? "border-l-positive"
                              : state === "late"
                                ? "border-l-negative"
                                : state === "due_today"
                                  ? "border-l-warning"
                                  : state === "archived"
                                    ? "border-l-transparent"
                                    : "border-l-info"
                          }`}
                        >
                          <p className={`font-semibold ${state === "done" ? "done-text" : ""}`}>
                            {task.title}
                          </p>
                          {showBoard && (
                            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <IconBadge
                                name={task.space.icon}
                                color={task.space.color}
                                size="sm"
                                fallback={DEFAULT_SPACE_ICON}
                              />
                              {task.space.name} › {task.board.name}
                            </p>
                          )}
                          {task.labels.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {task.labels.map((label) => (
                                <LabelChip key={label.id} label={label} />
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold"
                            style={{
                              color: tone(task.status?.color ?? "#94A3B8"),
                              borderColor: `color-mix(in oklab, ${tone(task.status?.color ?? "#94A3B8")} 35%, transparent)`,
                              backgroundColor: `color-mix(in oklab, ${tone(task.status?.color ?? "#94A3B8")} 12%, transparent)`,
                            }}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: tone(task.status?.color ?? "#94A3B8") }}
                            />
                            {task.status?.name ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {task.priority === "none" ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <PriorityBadge priority={task.priority} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <UserAvatar
                              user={
                                users.find((u) => u.user_id === task.responsible_user_id) ?? null
                              }
                              size={20}
                            />
                            <span className="hidden truncate text-xs lg:inline">
                              {nameOf(task.responsible_user_id)}
                            </span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {formatDateTimeBR(task.start_date, false)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-xs ${deadlineClass(state)}`}
                        >
                          {formatDateTimeBR(task.due_date, false)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                          {task.running ? formatClock(seconds) : formatDuration(seconds)}
                          {task.estimate_hours ? (
                            <span
                              className={estimateClass(estimateState(task.estimate_hours, seconds))}
                            >
                              {" / "}
                              {formatHours(task.estimate_hours)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          {task.participants.length > 0 ? (
                            <UserStack ids={task.participants} users={users} max={3} size={20} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleTimer(task);
                            }}
                            className={`rounded-full p-1.5 transition-colors ${
                              task.running && isMine
                                ? "bg-primary-soft text-primary"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            }`}
                            aria-label={
                              task.running && isMine ? "Pausar cronômetro" : "Iniciar cronômetro"
                            }
                          >
                            {task.running && isMine ? (
                              <Pause className="size-3.5" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    <Clock className="mx-auto mb-2 size-5 opacity-40" />
                    Nenhuma tarefa encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar pagination={pagination} itemLabel="tarefas" />
      </div>
    </div>
  );
}
