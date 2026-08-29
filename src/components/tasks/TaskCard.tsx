import { BellRing, Clock, ListChecks, Pause, Play, Timer } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import type { AccountUser, Task } from "@/lib/tasks";
import {
  deadlineClass,
  deadlineState,
  estimateClass,
  estimateState,
  formatClock,
  formatDuration,
  formatHours,
} from "@/lib/tasks-analytics";
import { LabelChip } from "./LabelPicker";
import { PriorityBadge } from "./PriorityPicker";
import { UserAvatar, UserStack } from "./UserPicker";

export function TaskCard({
  task,
  users,
  currentUserId,
  onOpen,
  onToggleTimer,
  onDragStart,
  showBoard = false,
}: {
  task: Task;
  users: AccountUser[];
  currentUserId: string | null;
  onOpen: () => void;
  onToggleTimer: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  showBoard?: boolean;
}) {
  const now = useNow(task.running ? 1000 : 60_000);
  const running = task.running;
  const seconds =
    task.trackedSeconds +
    (running ? Math.floor((now - new Date(running.started_at).getTime()) / 1000) : 0);
  const state = deadlineState({
    due_date: task.due_date,
    polarity: task.status?.polarity ?? null,
  });
  const doneSubtasks = task.subtasks.filter((s) => s.completed).length;
  const isMine = running?.user_id === currentUserId;
  const estimate = estimateState(task.estimate_hours, seconds);
  const pendingReminders = task.reminders.filter((r) => !r.delivered_at).length;

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      className="group cursor-pointer rounded-xl border border-border bg-card p-3 transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium leading-snug">{task.title}</p>
        <PriorityBadge priority={task.priority} showLabel={false} className="mt-0.5 shrink-0" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleTimer();
          }}
          className={`shrink-0 rounded-full p-1 transition-colors ${
            running && isMine
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground opacity-0 hover:bg-secondary group-hover:opacity-100"
          }`}
          aria-label={running && isMine ? "Pausar cronômetro" : "Iniciar cronômetro"}
          title={running && isMine ? "Pausar cronômetro" : "Iniciar cronômetro"}
        >
          {running && isMine ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
      </div>

      {showBoard && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {task.space.icon} {task.space.name} › {task.board.name}
        </p>
      )}

      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {task.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{task.labels.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        {task.due_date && (
          <span className={deadlineClass(state)}>
            {new Date(task.due_date).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <ListChecks className="size-3" />
            {doneSubtasks}/{task.subtasks.length}
          </span>
        )}
        {seconds > 0 && (
          <span
            className={`inline-flex items-center gap-1 ${running ? "font-semibold text-foreground" : ""}`}
          >
            <Clock className="size-3" />
            <span className="font-mono tabular-nums">
              {running ? formatClock(seconds) : formatDuration(seconds)}
            </span>
          </span>
        )}
        {task.estimate_hours ? (
          <span
            className={`inline-flex items-center gap-1 ${estimateClass(estimate)}`}
            title={`Estimativa: ${formatHours(task.estimate_hours)}`}
          >
            <Timer className="size-3" />
            <span className="font-mono tabular-nums">{formatHours(task.estimate_hours)}</span>
          </span>
        ) : null}
        {pendingReminders > 0 && (
          <span
            className="inline-flex items-center gap-1"
            title={`${pendingReminders} lembrete(s) agendado(s)`}
          >
            <BellRing className="size-3" />
            {pendingReminders}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {task.participants.length > 0 && (
            <UserStack ids={task.participants} users={users} max={3} size={18} />
          )}
          <UserAvatar
            user={users.find((u) => u.user_id === task.responsible_user_id) ?? null}
            size={22}
            title={
              task.responsible_user_id
                ? `Responsável: ${users.find((u) => u.user_id === task.responsible_user_id)?.name ?? ""}`
                : "Sem responsável"
            }
          />
        </span>
      </div>
    </div>
  );
}
