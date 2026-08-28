import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeleteStatus, useReorderStatuses, useSaveStatus, type BoardStatus } from "@/lib/tasks";
import { POLARITIES, type Polarity } from "@/lib/tasks-analytics";

/** Criação, renomeação, reordenação e exclusão dos status de um quadro. */
export function StatusManagerDialog({
  open,
  onOpenChange,
  boardId,
  statuses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  statuses: BoardStatus[];
}) {
  const save = useSaveStatus(boardId);
  const reorder = useReorderStatuses();
  const remove = useDeleteStatus();
  const [draft, setDraft] = useState<BoardStatus[]>([]);
  const [newName, setNewName] = useState("");

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
          <DialogTitle>Status do quadro</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Cada status possui uma polaridade interna. O nome é livre; a polaridade é o que o sistema
          usa para saber se a tarefa está ativa, concluída ou arquivada.
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
              <button
                onClick={async () => {
                  const fallback = draft.find((x) => x.id !== s.id);
                  if (!fallback) {
                    toast.error("O quadro precisa de ao menos um status");
                    return;
                  }
                  await remove.mutateAsync({ id: s.id, moveToStatusId: fallback.id });
                  toast.success(`Tarefas movidas para “${fallback.name}”`);
                }}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label="Excluir status"
              >
                <Trash2 className="size-3.5" />
              </button>
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
              color: "#64748B",
              polarity: "IN_PROGRESS",
              sort_order: draft.length,
            });
            setNewName("");
            toast.success("Status criado");
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Novo status…"
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
