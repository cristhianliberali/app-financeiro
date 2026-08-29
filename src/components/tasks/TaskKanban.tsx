import { useState } from "react";
import { Plus } from "lucide-react";
import { useTone } from "@/hooks/use-tone";
import type { AccountUser, Task } from "@/lib/tasks";
import { TaskCard } from "./TaskCard";

export type KanbanColumn = { id: string; name: string; color: string; hint?: string };

/**
 * Kanban com movimentação por drag and drop. Ao soltar o cartão em outra
 * coluna o status da tarefa é atualizado automaticamente.
 */
export function TaskKanban({
  columns,
  tasks,
  users,
  currentUserId,
  columnOf,
  onMove,
  onOpen,
  onToggleTimer,
  onAdd,
  showBoard = false,
}: {
  columns: KanbanColumn[];
  tasks: Task[];
  users: AccountUser[];
  currentUserId: string | null;
  columnOf: (task: Task) => string | null;
  onMove: (task: Task, columnId: string) => void;
  onOpen: (task: Task) => void;
  onToggleTimer: (task: Task) => void;
  onAdd?: (columnId: string) => void;
  showBoard?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const tone = useTone();

  if (columns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Este quadro ainda não possui status configurados.
      </div>
    );
  }

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {columns.map((col) => {
        const items = tasks.filter((t) => columnOf(t) === col.id);
        return (
          <div
            key={col.id}
            className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-surface/40 p-2 transition-colors ${
              over === col.id ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = dragging ?? e.dataTransfer.getData("text/plain");
              const task = tasks.find((t) => t.id === id);
              setDragging(null);
              if (task && columnOf(task) !== col.id) onMove(task, col.id);
            }}
          >
            <div className="mb-2 flex items-center gap-2 px-2 pt-1">
              <span
                className="size-2 rounded-full ring-1 ring-border"
                style={{ backgroundColor: tone(col.color) }}
              />
              <span className="text-sm font-semibold" title={col.hint}>
                {col.name}
              </span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
              {onAdd && (
                <button
                  onClick={() => onAdd(col.id)}
                  className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label={`Nova tarefa em ${col.name}`}
                  title={`Nova tarefa em ${col.name}`}
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  users={users}
                  currentUserId={currentUserId}
                  showBoard={showBoard}
                  onOpen={() => onOpen(task)}
                  onToggleTimer={() => onToggleTimer(task)}
                  onDragStart={(e) => {
                    setDragging(task.id);
                    e.dataTransfer.setData("text/plain", task.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                />
              ))}
              {items.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Arraste tarefas para cá
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
