import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LabelFilter } from "@/components/tasks/LabelPicker";
import type { AccountUser, Board, Label, Task } from "@/lib/tasks";
import { PRIORITIES } from "@/lib/tasks-analytics";

/**
 * Filtros do Kanban e do calendário.
 *
 * A lista tem os filtros dela, embutidos no cabeçalho da tabela; o Kanban e o
 * calendário não têm onde pendurá-los, então ficam aqui em cima. Quadro e
 * espaço usam a mesma barra — a diferença é que no espaço as tarefas vêm de
 * vários quadros, e aí entra o seletor de quadro.
 */
export type TaskFilterState = {
  term: string;
  priority: string;
  responsible: string;
  labels: string[];
  boardId: string;
};

export const EMPTY_FILTERS: TaskFilterState = {
  term: "",
  priority: "",
  responsible: "",
  labels: [],
  boardId: "",
};

export const hasFilters = (f: TaskFilterState) =>
  !!f.term || !!f.priority || !!f.responsible || !!f.boardId || f.labels.length > 0;

export function filterTasks(tasks: Task[], f: TaskFilterState): Task[] {
  const term = f.term.trim().toLowerCase();
  return tasks.filter((task) => {
    if (
      term &&
      !task.title.toLowerCase().includes(term) &&
      !task.labels.some((label) => label.name.toLowerCase().includes(term))
    ) {
      return false;
    }
    if (f.priority && task.priority !== f.priority) return false;
    if (f.responsible && (task.responsible_user_id ?? "") !== f.responsible) return false;
    if (f.boardId && task.board_id !== f.boardId) return false;
    if (f.labels.length > 0 && !f.labels.every((id) => task.labels.some((l) => l.id === id))) {
      return false;
    }
    return true;
  });
}

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-card px-2 text-sm outline-none focus:ring-1 focus:ring-ring";

export function TaskFilterBar({
  value,
  onChange,
  labels,
  users,
  boards,
  shown,
  total,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  labels: Label[];
  users: AccountUser[];
  /** Quando informado, a barra ganha o seletor de quadro. */
  boards?: Board[];
  shown: number;
  total: number;
}) {
  const set = <K extends keyof TaskFilterState>(key: K, next: TaskFilterState[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1 sm:max-w-72">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value.term}
          onChange={(e) => set("term", e.target.value)}
          placeholder="Pesquisar tarefas ou etiquetas…"
          className="pl-8"
        />
      </div>

      {boards && boards.length > 1 && (
        <select
          className={SELECT_CLASS}
          value={value.boardId}
          onChange={(e) => set("boardId", e.target.value)}
          aria-label="Filtrar por quadro"
        >
          <option value="">Todos os quadros</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      <select
        className={SELECT_CLASS}
        value={value.priority}
        onChange={(e) => set("priority", e.target.value)}
        aria-label="Filtrar por prioridade"
      >
        <option value="">Todas as prioridades</option>
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <LabelFilter labels={labels} value={value.labels} onChange={(next) => set("labels", next)} />

      <select
        className={SELECT_CLASS}
        value={value.responsible}
        onChange={(e) => set("responsible", e.target.value)}
        aria-label="Filtrar por responsável"
      >
        <option value="">Todos os responsáveis</option>
        {users.map((u) => (
          <option key={u.user_id} value={u.user_id}>
            {u.name}
          </option>
        ))}
      </select>

      {hasFilters(value) && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" /> Limpar filtros ({shown}/{total})
        </button>
      )}
    </div>
  );
}
