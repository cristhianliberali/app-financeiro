import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { useAppState } from "@/lib/app-state";
import {
  useAccountUsers,
  useBoardMembers,
  useCreateBoard,
  useDeleteBoard,
  useStatusTemplates,
  useTasks,
  useUpdateBoard,
  type Board,
  type Space,
} from "@/lib/tasks";
import {
  BOARD_STAGES,
  BOARD_VIEWS,
  PALETTE,
  POLARITIES,
  STATUS_PRESETS,
  type BoardStage,
  type BoardView,
  type Polarity,
  type StatusSeed,
} from "@/lib/tasks-analytics";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { UserMultiSelect, UserSelect } from "./UserPicker";

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

export function BoardDialog({
  open,
  onOpenChange,
  spaces,
  defaultSpaceId,
  board,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaces: Space[];
  defaultSpaceId: string | null;
  /** Quadro existente; nulo abre o formulário de criação. */
  board: Board | null;
  onCreated?: (boardId: string) => void;
}) {
  const { accountId } = useAppState();
  const { data: users = [] } = useAccountUsers(accountId);
  const { data: templates = [] } = useStatusTemplates(accountId);
  const { data: tasks = [] } = useTasks({ accountId });
  const create = useCreateBoard();
  const update = useUpdateBoard();
  const remove = useDeleteBoard();
  const { data: currentMembers } = useBoardMembers(board?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    space_id: defaultSpaceId ?? "",
    name: "",
    description: "",
    owner_id: null as string | null,
    start_date: "",
    due_date: "",
    status: "active" as BoardStage,
    default_view: "kanban" as BoardView,
    color: PALETTE[0]!,
  });
  const [members, setMembers] = useState<string[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [preset, setPreset] = useState(STATUS_PRESETS[0]!.id);
  const [statuses, setStatuses] = useState<StatusSeed[]>(STATUS_PRESETS[0]!.statuses);

  useEffect(() => {
    if (!open) return;
    setForm({
      space_id: board?.space_id ?? defaultSpaceId ?? "",
      name: board?.name ?? "",
      description: board?.description ?? "",
      owner_id: board?.owner_id ?? null,
      start_date: board?.start_date ?? "",
      due_date: board?.due_date ?? "",
      status: board?.status ?? "active",
      default_view: board?.default_view ?? "kanban",
      color: board?.color ?? PALETTE[0]!,
    });
    setMembers([]);
    setMembersLoaded(!board);
    setPreset(STATUS_PRESETS[0]!.id);
    setStatuses(STATUS_PRESETS[0]!.statuses.map((s) => ({ ...s })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, board?.id, defaultSpaceId]);

  // Participantes chegam de forma assíncrona: carregamos uma única vez por
  // abertura para preservar a seleção em andamento.
  useEffect(() => {
    if (!open || membersLoaded || !currentMembers) return;
    setMembers(currentMembers);
    setMembersLoaded(true);
  }, [open, membersLoaded, currentMembers]);

  /**
   * Conjuntos oferecidos na criação: os que vêm com o app e os que a conta
   * guardou. Os da conta primeiro — quem salvou um modelo o quer à mão.
   */
  const conjuntos = [
    ...templates.map((t) => ({ id: `modelo:${t.id}`, label: t.name, statuses: t.statuses })),
    ...STATUS_PRESETS,
  ];

  function applyPreset(id: string) {
    setPreset(id);
    const found = conjuntos.find((p) => p.id === id);
    if (found) setStatuses(found.statuses.map((s) => ({ ...s })));
  }

  function patchStatus(index: number, patch: Partial<StatusSeed>) {
    setStatuses((list) => list.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setPreset("custom");
  }

  function moveStatus(index: number, dir: -1 | 1) {
    setStatuses((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setPreset("custom");
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error("Informe o nome do quadro");
      return;
    }
    if (!form.space_id) {
      toast.error("Selecione o espaço do quadro");
      return;
    }

    if (board) {
      await update.mutateAsync({
        id: board.id,
        patch: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          owner_id: form.owner_id,
          start_date: form.start_date || null,
          due_date: form.due_date || null,
          status: form.status,
          default_view: form.default_view,
          color: form.color,
        },
        memberIds: members,
      });
      toast.success("Quadro atualizado");
      onOpenChange(false);
      return;
    }

    const clean = statuses.filter((s) => s.name.trim());
    if (clean.length === 0) {
      toast.error("Configure ao menos um status");
      return;
    }
    const boardId = await create.mutateAsync({
      spaceId: form.space_id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      ownerId: form.owner_id,
      startDate: form.start_date || null,
      dueDate: form.due_date || null,
      defaultView: form.default_view,
      color: form.color,
      statuses: clean.map((s) => ({ ...s, name: s.name.trim() })),
      memberIds: members,
    });
    toast.success("Quadro criado");
    onOpenChange(false);
    onCreated?.(boardId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{board ? "Editar quadro" : "Novo quadro"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Novo aplicativo financeiro"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Descrição</Label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Espaço</Label>
            <select
              className={SELECT_CLASS}
              value={form.space_id}
              disabled={!!board}
              onChange={(e) => setForm({ ...form, space_id: e.target.value })}
            >
              {!form.space_id && <option value="">Selecione um espaço</option>}
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {/* Só o nome: `<option>` não aceita componente, e um espaço
                      antigo ainda guarda um emoji na coluna do ícone — era ele que
                      vazava aqui, cru, no meio de uma lista sem ícone nenhum. */}
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Responsável pelo quadro</Label>
            <UserSelect
              users={users}
              value={form.owner_id}
              onChange={(id) => setForm({ ...form, owner_id: id })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Data de início</Label>
            <DateField
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Conclusão prevista</Label>
            <DateField
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Status do quadro</Label>
            <select
              className={SELECT_CLASS}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as BoardStage })}
            >
              {BOARD_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>Visualização padrão</Label>
            <select
              className={SELECT_CLASS}
              value={form.default_view}
              onChange={(e) => setForm({ ...form, default_view: e.target.value as BoardView })}
            >
              {BOARD_VIEWS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Participantes</Label>
            <UserMultiSelect users={users} value={members} onChange={setMembers} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  onClick={() => setForm({ ...form, color })}
                  className={`size-8 rounded-full border-2 transition-transform ${
                    form.color === color
                      ? "scale-110 border-foreground shadow-md"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={`Cor ${color}`}
                />
              ))}
            </div>
          </div>
        </div>

        {!board && (
          <div className="space-y-3 rounded-xl border border-border bg-surface/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Status das tarefas</Label>
              <div className="flex flex-wrap gap-1">
                {conjuntos.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      preset === p.id ? "border-primary bg-primary/10" : "border-border"
                    }`}
                    // O modelo da conta ganha um traço da marca: no meio dos
                    // conjuntos do app, é o que a equipe combinou.
                    title={p.id.startsWith("modelo:") ? "Modelo salvo nesta conta" : undefined}
                  >
                    {p.id.startsWith("modelo:") ? `★ ${p.label}` : p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              {statuses.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="flex flex-col text-muted-foreground">
                    <button
                      onClick={() => moveStatus(i, -1)}
                      className="hover:text-foreground"
                      aria-label="Mover para cima"
                    >
                      <GripVertical className="size-3.5" />
                    </button>
                  </span>
                  <Input
                    value={s.name}
                    onChange={(e) => patchStatus(i, { name: e.target.value })}
                    className="h-8 flex-1 min-w-32"
                  />
                  <select
                    value={s.polarity}
                    onChange={(e) => patchStatus(i, { polarity: e.target.value as Polarity })}
                    className="h-8 rounded-md border border-input bg-card px-2 text-xs outline-none"
                    title="Polaridade usada por métricas e automações"
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
                    onChange={(e) => patchStatus(i, { color: e.target.value })}
                    className="size-8 cursor-pointer rounded border border-border bg-card"
                    aria-label="Cor do status"
                  />
                  <button
                    onClick={() => {
                      setStatuses((list) => list.filter((_, idx) => idx !== i));
                      setPreset("custom");
                    }}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Remover status"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => moveStatus(i, 1)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Mover para baixo"
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatuses((list) => [
                  ...list,
                  { name: "Novo status", color: "#737373", polarity: "IN_PROGRESS" },
                ]);
                setPreset("custom");
              }}
            >
              <Plus className="mr-1 size-3.5" /> Adicionar status
            </Button>
            <p className="text-[11px] text-muted-foreground">
              A polaridade informa ao sistema se a tarefa está ativa, concluída ou fora do fluxo —
              independente do nome escolhido.
            </p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {board ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 size-3.5" /> Excluir
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {board && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          itemLabel="quadro"
          itemName={board.name}
          consequences={[
            `${tasks.filter((t) => t.board_id === board.id).length} tarefa(s) do quadro`,
            "Status personalizados, subtarefas e todo o tempo registrado",
          ]}
          onConfirm={async () => {
            await remove.mutateAsync(board.id);
            toast.success(`Quadro “${board.name}” excluído`);
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
