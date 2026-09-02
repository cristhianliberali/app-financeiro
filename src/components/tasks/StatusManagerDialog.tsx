import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Bookmark, Lock, Plus, Trash2 } from "lucide-react";
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
  useDeleteStatusTemplate,
  useReorderStatuses,
  useSaveStatus,
  useSaveStatusTemplate,
  useStatusTemplates,
  type BoardStatus,
  type Task,
} from "@/lib/tasks";
import { useAppState } from "@/lib/app-state";
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
  const { accountId } = useAppState();
  const save = useSaveStatus(boardId);
  const reorder = useReorderStatuses();
  const remove = useDeleteStatus();
  const { data: templates = [] } = useStatusTemplates(accountId);
  const saveTemplate = useSaveStatusTemplate();
  const removeTemplate = useDeleteStatusTemplate();
  const [draft, setDraft] = useState<BoardStatus[]>([]);
  const [newName, setNewName] = useState("");
  const [templateName, setTemplateName] = useState("");

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

  /** Guarda as etapas deste quadro como modelo da conta. */
  async function guardarModelo() {
    if (!accountId) return;
    const nome = templateName.trim();
    if (!nome) {
      toast.error("Dê um nome ao modelo");
      return;
    }
    try {
      await saveTemplate.mutateAsync({
        accountId,
        name: nome,
        statuses: draft.map((s) => ({ name: s.name, color: s.color, polarity: s.polarity })),
      });
      setTemplateName("");
      toast.success(`Modelo “${nome}” salvo para esta conta`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o modelo");
    }
  }

  /**
   * Traz as etapas do modelo que ainda faltam neste quadro.
   *
   * Acrescenta, nunca substitui: trocar as etapas de um quadro em uso deixaria
   * as tarefas órfãs de status. O que já existe pelo nome é deixado como está.
   */
  async function aplicarModelo(id: string) {
    const modelo = templates.find((t) => t.id === id);
    if (!modelo) return;
    const existentes = new Set(draft.map((s) => s.name.trim().toLowerCase()));
    const faltando = modelo.statuses.filter((s) => !existentes.has(s.name.trim().toLowerCase()));
    if (faltando.length === 0) {
      toast.info(`O quadro já tem todas as etapas de “${modelo.name}”`);
      return;
    }
    try {
      for (const [i, seed] of faltando.entries()) {
        await save.mutateAsync({
          name: seed.name,
          color: seed.color,
          polarity: seed.polarity,
          sort_order: draft.length + i,
        });
      }
      toast.success(
        `${faltando.length} etapa(s) de “${modelo.name}” ${
          faltando.length === 1 ? "adicionada" : "adicionadas"
        }`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aplicar o modelo");
    }
  }

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

        {/*
          Modelos da conta. Um quadro afinado costuma valer para os próximos, e
          recriar as etapas à mão em cada um sai diferente toda vez — um "Em
          revisão" aqui, um "Revisão" ali —, o que estraga qualquer leitura que
          cruze quadros.
        */}
        <section className="space-y-2 rounded-xl border border-border bg-surface/60 p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Bookmark className="size-4" /> Modelos da conta
          </h3>

          {templates.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 rounded-lg border border-border bg-card pl-2 text-xs"
                >
                  <button
                    onClick={() => void aplicarModelo(t.id)}
                    disabled={save.isPending}
                    className="py-1.5 font-medium transition-colors hover:text-primary disabled:opacity-50"
                    title={`Trazer para este quadro: ${t.statuses.map((x) => x.name).join(", ")}`}
                  >
                    {t.name}
                    <span className="ml-1 text-muted-foreground">({t.statuses.length})</span>
                  </button>
                  <button
                    onClick={() => {
                      void removeTemplate
                        .mutateAsync(t.id)
                        .then(() => toast.success(`Modelo “${t.name}” excluído`));
                    }}
                    className="px-1.5 py-1.5 text-muted-foreground transition-colors hover:text-destructive"
                    aria-label={`Excluir modelo ${t.name}`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhum modelo salvo ainda. Guarde as etapas deste quadro para reaproveitá-las nos
              próximos.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Nome do modelo (ex.: Desenvolvimento)"
              className="h-9 min-w-48 flex-1"
              onKeyDown={(e) => e.key === "Enter" && void guardarModelo()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void guardarModelo()}
              disabled={saveTemplate.isPending || draft.length === 0}
            >
              Salvar estas etapas
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Aplicar um modelo <span className="font-medium text-foreground">acrescenta</span> as
            etapas que faltam; nada é substituído, para nenhuma tarefa ficar sem etapa. Repetir um
            nome de modelo substitui o que estava salvo.
          </p>
        </section>

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
