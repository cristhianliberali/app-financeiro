import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Clock, Pause, Play, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import type { AccountUser, Task } from "@/lib/tasks";
import {
  DEADLINE_LABEL,
  deadlineClass,
  deadlineState,
  formatClock,
  formatDuration,
  formatDateTimeBR,
} from "@/lib/tasks-analytics";
import { UserAvatar, UserStack } from "./UserPicker";

type SortKey = "title" | "status" | "responsible" | "start" | "due" | "tracked";
type GroupKey = "none" | "status" | "responsible" | "board" | "space";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring";

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
  const [term, setTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("");
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
      if (t && !task.title.toLowerCase().includes(t)) return false;
      if (statusFilter && task.status?.name !== statusFilter) return false;
      if (responsibleFilter && (task.responsible_user_id ?? "") !== responsibleFilter) return false;
      if (
        deadlineFilter &&
        deadlineState({ due_date: task.due_date, polarity: task.status?.polarity ?? null }) !==
          deadlineFilter
      )
        return false;
      return true;
    });
  }, [tasks, term, statusFilter, responsibleFilter, deadlineFilter]);

  const sorted = useMemo(() => {
    const dir = sort.asc ? 1 : -1;
    const value = (task: Task) => {
      switch (sort.key) {
        case "title":
          return task.title.toLowerCase();
        case "status":
          return `${task.status?.sort_order ?? 99}${task.status?.name ?? ""}`;
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

  const groups = useMemo(() => {
    if (group === "none") return [{ key: "", label: "", items: sorted }];
    const map = new Map<string, Task[]>();
    for (const task of sorted) {
      const label =
        group === "status"
          ? (task.status?.name ?? "Sem status")
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
  }, [sorted, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (key: SortKey, label: string, className = "") => (
    <th className={`px-3 py-2 text-left font-medium ${className}`}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
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
          <option value="responsible">Agrupar por responsável</option>
          <option value="board">Agrupar por quadro</option>
          <option value="space">Agrupar por espaço</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              {header("title", "Tarefa")}
              {header("status", "Status")}
              {header("responsible", "Responsável")}
              {header("start", "Início")}
              {header("due", "Prazo")}
              {header("tracked", "Tempo")}
              <th className="px-3 py-2 text-left font-medium">Participantes</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={`grp-${g.key}`}>
                {g.label && (
                  <tr className="bg-secondary/40">
                    <td colSpan={8} className="px-3 py-1.5 text-xs font-semibold">
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
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/40"
                      onClick={() => onOpen(task)}
                    >
                      <td className="px-3 py-2">
                        <p className="font-medium">{task.title}</p>
                        {showBoard && (
                          <p className="text-[11px] text-muted-foreground">
                            {task.space.icon} {task.space.name} › {task.board.name}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs">
                          <span
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: task.status?.color ?? "#94A3B8" }}
                          />
                          {task.status?.name ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <UserAvatar
                            user={users.find((u) => u.user_id === task.responsible_user_id) ?? null}
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
                      <td className={`whitespace-nowrap px-3 py-2 text-xs ${deadlineClass(state)}`}>
                        {formatDateTimeBR(task.due_date, false)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                        {task.running ? formatClock(seconds) : formatDuration(seconds)}
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
                          className={`rounded-full p-1 transition-colors hover:bg-secondary ${
                            task.running && isMine ? "text-primary" : "text-muted-foreground"
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
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  <Clock className="mx-auto mb-2 size-5 opacity-40" />
                  Nenhuma tarefa encontrada com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
