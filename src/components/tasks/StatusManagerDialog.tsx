import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDeleteStatus,
  useReorderStatuses,
  useSaveStatus,
  type BoardStatus,
  type Task,
} from "@/lib/tasks";
import { POLARITIES, type Polarity } from "@/lib/tasks-analytics";

/** Criação, renomeação, reordenação e exclusão das etapas de um quadro. */
export function StatusManagerDialog({
  open,
  onOpenChange,
  boardId,
  statuses,
  tasks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  statuses: BoardStatus[];
  /** Tarefas do quadro — é o que diz quais etapas ainda estão em uso. */
  tasks: Task[];
}) {
  const save = useSaveStatus(boardId);
  const reorder = useReorderStatuses();
  const remove = useDeleteStatus();
  const [draft, setDraft] = useState<BoardStatus[]>([]);
  const [newName, setNewName] = useState("");

  const taskCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (!task.status_id) continue;
      map.set(task.status_id, (map.get(task.status_id) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  useEffect(() => {
    if (open) setDraft(statuses);
  }, [open, statuses]);

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
    await reorder.mutateAsync(next.map((s, i) => ({ id: s.id, sort_order: i })));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Etapas do quadro</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Cada etapa possui uma polaridade interna. O nome é livre; a polaridade é o que o sistema
          usa para saber se a tarefa está ativa, concluída ou arquivada. Uma etapa só pode ser
          excluída quando está vazia — mova ou exclua as tarefas dela antes.
        </p>

        <div className="space-y-2">
          {draft.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  aria-label="Mover para cima"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  aria-label="Mover para baixo"
                >
                  <ArrowDown className="size-3" />
                </button>
              </div>
              <Input
                value={s.name}
                onChange={(e) =>
                  setDraft((list) =>
                    list.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)),
                  )
                }
                onBlur={() =>
                  s.name.trim() &&
                  save.mutate({
                    id: s.id,
                    name: s.name.trim(),
                    color: s.color,
                    polarity: s.polarity,
                  })
                }
                className="h-9 min-w-32 flex-1"
              />
              <select
                value={s.polarity}
                onChange={(e) => {
                  const polarity = e.target.value as Polarity;
                  setDraft((list) => list.map((x) => (x.id === s.id ? { ...x, polarity } : x)));
                  save.mutate({ id: s.id, name: s.name, color: s.color, polarity });
                }}
                className="h-9 rounded-md border border-input bg-card px-2 text-xs outline-none"
              >
                {POLARITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="color"
                value={s.color}
                onChange={(e) => {
                  const color = e.target.value;
                  setDraft((list) => list.map((x) => (x.id === s.id ? { ...x, color } : x)));
                  save.mutate({ id: s.id, name: s.name, color, polarity: s.polarity });
                }}
                className="size-9 cursor-pointer rounded border border-border bg-card"
                aria-label="Cor do status"
              />
              <StatusDeleteButton
                name={s.name}
                inUse={taskCount.get(s.id) ?? 0}
                isLast={draft.length <= 1}
                onDelete={async () => {
                  try {
                    await remove.mutateAsync(s.id);
                    toast.success(`Etapa “${s.name}” excluída`);
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Não foi possível excluir a etapa",
                    );
                  }
                }}
              />
            </div>
          ))}
        </div>

        <form
          className="flex gap-2 border-t border-border pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await save.mutateAsync({
              name: newName.trim(),
              color: "#737373",
              polarity: "IN_PROGRESS",
              sort_order: draft.length,
            });
            setNewName("");
            toast.success("Etapa criada");
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nova etapa…"
          />
          <Button type="submit" variant="outline" disabled={!newName.trim()}>
            <Plus className="size-4" />
          </Button>
        </form>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Excluir só aparece habilitado quando a etapa está vazia. Bloqueado, o botão
 * vira um cadeado que diz por quê — o servidor recusa do mesmo jeito, mas quem
 * está na tela merece saber antes de clicar.
 */
function StatusDeleteButton({
  name,
  inUse,
  isLast,
  onDelete,
}: {
  name: string;
  /** Quantas tarefas ainda estão nesta etapa. */
  inUse: number;
  isLast: boolean;
  onDelete: () => void;
}) {
  const reason = inUse
    ? `“${name}” tem ${inUse} ${inUse === 1 ? "tarefa" : "tarefas"}. Mova ou exclua as tarefas para poder remover a etapa.`
    : isLast
      ? "O quadro precisa de ao menos uma etapa."
      : null;

  if (reason) {
    return (
      <span
        className="flex items-center gap-1 text-muted-foreground/60"
        title={reason}
        aria-label={reason}
      >
        <Lock className="size-3.5" />
        {inUse > 0 && <span className="font-mono text-[10px]">{inUse}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={onDelete}
      className="text-muted-foreground transition-colors hover:text-destructive"
      aria-label={`Excluir etapa ${name}`}
      title={`Excluir etapa ${name}`}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
