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
      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
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
            className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-surface p-2 transition-all ${
              over === col.id
                ? "border-primary bg-primary-soft ring-2 ring-ring/25"
                : "border-border"
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
            {/* Faixa da cor do status no topo da coluna: identifica a coluna
                mesmo quando o cabeçalho sai da tela na rolagem horizontal. */}
            <div
              className="mx-2 mb-2 mt-1 h-1 rounded-full"
              style={{ backgroundColor: tone(col.color) }}
            />
            <div className="mb-2 flex items-center gap-2 px-2">
              <span className="text-sm font-bold tracking-tight" title={col.hint}>
                {col.name}
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                {items.length}
              </span>
              {onAdd && (
                <button
                  onClick={() => onAdd(col.id)}
                  className="ml-auto rounded-lg p-1 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
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
                <p className="rounded-xl border border-dashed border-border px-2 py-8 text-center text-xs text-muted-foreground">
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
