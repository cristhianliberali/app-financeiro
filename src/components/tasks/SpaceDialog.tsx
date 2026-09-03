import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useAccountUsers,
  useBoards,
  useDeleteSpace,
  useSaveSpace,
  useSpaceMembers,
  useTasks,
  type Space,
} from "@/lib/tasks";
import { PALETTE } from "@/lib/tasks-analytics";
import { DEFAULT_SPACE_ICON } from "@/lib/icons";
import { IconPicker } from "@/components/IconPicker";
import { formatDateBR } from "@/lib/format";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { UserMultiSelect } from "./UserPicker";

export function SpaceDialog({
  open,
  onOpenChange,
  accountId,
  space,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string | null;
  /** Espaço existente; nulo abre o formulário de criação. */
  space: Space | null;
  onCreated?: (spaceId: string) => void;
}) {
  const { accountId: activeAccountId } = useAppState();
  const { data: users = [] } = useAccountUsers(accountId ?? activeAccountId);
  const { data: boards = [] } = useBoards({ accountId });
  const { data: tasks = [] } = useTasks({ accountId });
  const save = useSaveSpace(accountId);
  const remove = useDeleteSpace();
  const { data: currentMembers } = useSpaceMembers(space?.id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    icon: DEFAULT_SPACE_ICON,
    color: PALETTE[0]!,
    archived: false,
  });
  const [members, setMembers] = useState<string[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: space?.name ?? "",
      description: space?.description ?? "",
      icon: space?.icon ?? DEFAULT_SPACE_ICON,
      color: space?.color ?? PALETTE[0]!,
      archived: !!space?.archived_at,
    });
    setMembers([]);
    setMembersLoaded(!space);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, space?.id]);

  // Os membros chegam de forma assíncrona; carregamos uma única vez por abertura
  // para não descartar a seleção em andamento quando a consulta é revalidada.
  useEffect(() => {
    if (!open || membersLoaded || !currentMembers) return;
    setMembers(currentMembers);
    setMembersLoaded(true);
  }, [open, membersLoaded, currentMembers]);

  async function submit() {
    if (!form.name.trim()) {
      toast.error("Informe o nome do espaço");
      return;
    }
    const savedId = await save.mutateAsync({
      ...(space ? { id: space.id } : {}),
      name: form.name.trim(),
      description: form.description.trim() || null,
      icon: form.icon,
      color: form.color,
      archived: form.archived,
      memberIds: members,
    });
    toast.success(space ? "Espaço atualizado" : "Espaço criado");
    onOpenChange(false);
    if (!space) onCreated?.(savedId as string);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{space ? "Editar espaço" : "Novo espaço"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex.: Marketing, Desenvolvimento, Clientes…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
              placeholder="Para que serve este espaço?"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Ícone</Label>
            <IconPicker
              value={form.icon}
              color={form.color}
              fallback={DEFAULT_SPACE_ICON}
              onChange={(icon) => setForm({ ...form, icon })}
            />
          </div>

          <div className="space-y-1.5">
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

          <div className="space-y-1.5">
            <Label>Usuários com acesso</Label>
            <UserMultiSelect users={users} value={members} onChange={setMembers} />
            <p className="text-[11px] text-muted-foreground">
              Sem ninguém selecionado, todos os membros da conta enxergam este espaço.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-surface/60 p-3.5">
            <div>
              <p className="text-sm font-medium">Arquivar espaço</p>
              <p className="text-[11px] text-muted-foreground">
                Espaços arquivados saem da navegação principal.
              </p>
            </div>
            <Switch
              checked={form.archived}
              onCheckedChange={(v) => setForm({ ...form, archived: v })}
            />
          </div>

          {space && (
            <p className="text-[11px] text-muted-foreground">
              Criado em {formatDateBR(space.created_at.slice(0, 10))} por{" "}
              {users.find((u) => u.user_id === space.created_by)?.name ?? "—"}.
            </p>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {space ? (
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
            <Button onClick={submit} disabled={save.isPending}>
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {space && (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          itemLabel="espaço"
          itemName={space.name}
          consequences={[
            `${boards.filter((b) => b.space_id === space.id).length} quadro(s) deste espaço`,
            `${tasks.filter((t) => t.space.id === space.id).length} tarefa(s), com subtarefas e tempo registrado`,
          ]}
          onConfirm={async () => {
            await remove.mutateAsync(space.id);
            toast.success(`Espaço “${space.name}” excluído`);
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
