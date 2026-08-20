import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { useCategories, useUpsert, type Transaction } from "@/lib/data";
import { toISODate } from "@/lib/format";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "income" | "expense";
  editing?: Transaction | null;
};

export function TransactionDialog({ open, onOpenChange, kind, editing }: Props) {
  const { profileId } = useAppState();
  const { data: categories } = useCategories(profileId);
  const upsert = useUpsert("transactions");
  const today = toISODate(new Date());

  const [form, setForm] = useState({
    description: "",
    amount: "",
    transaction_date: today,
    due_date: today,
    category_id: "",
    status: "pending" as "paid" | "pending",
    installments: "1",
    notes: "",
  });

  useEffect(() => {
    if (editing) {
      setForm({
        description: editing.description,
        amount: String(editing.amount),
        transaction_date: editing.transaction_date,
        due_date: editing.due_date,
        category_id: editing.category_id ?? "",
        status: editing.status,
        installments: String(editing.installment_total ?? 1),
        notes: editing.notes ?? "",
      });
    } else {
      setForm((f) => ({ ...f, description: "", amount: "", notes: "", installments: "1" }));
    }
  }, [editing, open]);

  const options = (categories ?? []).filter((c) => c.kind === kind);

  async function save() {
    const amount = Number(form.amount.replace(",", "."));
    if (!form.description || !amount) {
      toast.error("Informe descrição e valor");
      return;
    }
    const installments = Math.max(1, Number(form.installments) || 1);
    const base = {
      profile_id: profileId,
      category_id: form.category_id || null,
      kind,
      status: form.status,
      notes: form.notes || null,
    };

    try {
      if (editing) {
        await upsert.mutateAsync({
          id: editing.id,
          ...base,
          description: form.description,
          amount,
          transaction_date: form.transaction_date,
          due_date: form.due_date,
          installment_no: editing.installment_no,
          installment_total: editing.installment_total,
          installment_group: editing.installment_group,
        });
      } else if (installments > 1) {
        const group = crypto.randomUUID();
        const per = Number((amount / installments).toFixed(2));
        const rows = Array.from({ length: installments }, (_, i) => {
          const due = new Date(form.due_date);
          due.setMonth(due.getMonth() + i);
          return {
            ...base,
            description: form.description,
            amount: per,
            transaction_date: form.transaction_date,
            due_date: toISODate(due),
            installment_no: i + 1,
            installment_total: installments,
            installment_group: group,
          };
        });
        await upsert.mutateAsync(rows);
      } else {
        await upsert.mutateAsync({
          ...base,
          description: form.description,
          amount,
          transaction_date: form.transaction_date,
          due_date: form.due_date,
        });
      }
      toast.success(editing ? "Lançamento atualizado" : "Lançamento registrado");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar lançamento" : kind === "income" ? "Nova receita" : "Nova despesa"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Descrição</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Valor total (R$)</Label>
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Sem categoria</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Data da transação</Label>
            <Input
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vencimento / pagamento</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          {!editing && (
            <div className="space-y-1.5">
              <Label>Parcelas</Label>
              <Input
                type="number"
                min={1}
                max={48}
                value={form.installments}
                onChange={(e) => setForm({ ...form, installments: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Status</Label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as "paid" | "pending" })}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="pending">Agendado</option>
              <option value="paid">{kind === "income" ? "Recebido" : "Pago"}</option>
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
