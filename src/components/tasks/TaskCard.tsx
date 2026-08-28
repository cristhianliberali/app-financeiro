import { Clock, ListChecks, Pause, Play } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import type { AccountUser, Task } from "@/lib/tasks";
import { deadlineClass, deadlineState, formatClock, formatDuration } from "@/lib/tasks-analytics";
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

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      className="group cursor-pointer rounded-xl border border-border bg-card p-3 transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium leading-snug">{task.title}</p>
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
          <span className={`inline-flex items-center gap-1 ${running ? "text-primary" : ""}`}>
            <Clock className="size-3" />
            <span className="font-mono tabular-nums">
              {running ? formatClock(seconds) : formatDuration(seconds)}
            </span>
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
