import { useState } from "react";
import { toast } from "sonner";
import { BellPlus, BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { useDeleteReminder, useSaveReminder, type AccountUser, type Reminder } from "@/lib/tasks";
import { formatDateTimeBR, fromLocalInput, toLocalInput } from "@/lib/tasks-analytics";
import { UserAvatar, UserSelect } from "./UserPicker";

/** Data/hora inicial sugerida: amanhã às 9h, arredondado. */
function defaultRemindAt() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date.toISOString());
}

/**
 * Lembretes da tarefa. Cada linha é um aviso agendado para alguém da conta —
 * quando a hora chega, o app notifica o destinatário (veja `useTaskNotifications`).
 */
export function TaskReminders({
  taskId,
  reminders,
  users,
  currentUserId,
  canEdit = true,
}: {
  taskId: string;
  reminders: Reminder[];
  users: AccountUser[];
  currentUserId: string | null;
  canEdit?: boolean;
}) {
  const save = useSaveReminder();
  const remove = useDeleteReminder();
  const [draft, setDraft] = useState<{
    remind_at: string;
    user_id: string | null;
    note: string;
  } | null>(null);

  async function submit() {
    if (!draft?.remind_at) {
      toast.error("Informe a data e a hora do lembrete");
      return;
    }
    const remindAt = fromLocalInput(draft.remind_at);
    if (!remindAt) {
      toast.error("Data do lembrete inválida");
      return;
    }
    try {
      await save.mutateAsync({
        task_id: taskId,
        user_id: draft.user_id,
        remind_at: remindAt,
        note: draft.note.trim() || null,
      });
      setDraft(null);
      toast.success("Lembrete agendado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o lembrete");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          Lembretes{" "}
          {reminders.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({reminders.length})</span>
          )}
        </Label>
        {canEdit && !draft && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setDraft({ remind_at: defaultRemindAt(), user_id: currentUserId, note: "" })
            }
          >
            <BellPlus className="mr-1 size-3.5" /> Novo lembrete
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {reminders.map((reminder) => {
          const target = users.find((u) => u.user_id === reminder.user_id) ?? null;
          const delivered = !!reminder.delivered_at;
          return (
            <div
              key={reminder.id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
            >
              <BellRing
                className={`size-3.5 shrink-0 ${delivered ? "text-muted-foreground" : ""}`}
              />
              <span
                className={`font-mono ${delivered ? "text-muted-foreground line-through" : ""}`}
              >
                {formatDateTimeBR(reminder.remind_at)}
              </span>
              <UserAvatar user={target} size={18} title={target?.name ?? "Destinatário"} />
              {reminder.note && (
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {reminder.note}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {delivered ? "Enviado" : "Agendado"}
              </span>
              {canEdit && (
                <button
                  onClick={() => remove.mutate(reminder.id)}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="Excluir lembrete"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          );
        })}

        {reminders.length === 0 && !draft && (
          <p className="text-xs text-muted-foreground">
            Nenhum lembrete. Agende um aviso e o app notifica na hora marcada.
          </p>
        )}
      </div>

      {draft && (
        <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Quando avisar</Label>
            <DateField
              type="datetime-local"
              autoFocus
              value={draft.remind_at}
              onChange={(e) => setDraft({ ...draft, remind_at: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Avisar quem</Label>
            <UserSelect
              users={users}
              value={draft.user_id}
              onChange={(id) => setDraft({ ...draft, user_id: id })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Observação (opcional)</Label>
            <Input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Ex.: cobrar retorno do cliente"
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" onClick={submit} disabled={save.isPending}>
              Agendar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
