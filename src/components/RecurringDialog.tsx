import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { activeCategories, useCategories, useRecurring, useRemove, useUpsert } from "@/lib/data";
import { brl, toISODate } from "@/lib/format";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function RecurringDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const { data: rules = [] } = useRecurring(profileId);
  const upsert = useUpsert("recurring_rules");
  const remove = useRemove("recurring_rules");

  const [form, setForm] = useState({
    description: "",
    amount: "",
    kind: "expense" as "income" | "expense",
    frequency: "monthly" as "monthly" | "weekly" | "yearly",
    day_of_month: "5",
    category_id: "",
    start_date: toISODate(new Date()),
  });

  async function save() {
    if (!form.description || !form.amount) {
      toast.error("Preencha descrição e valor");
      return;
    }
    await upsert.mutateAsync({
      profile_id: profileId,
      description: form.description,
      amount: Number(form.amount.replace(",", ".")),
      kind: form.kind,
      frequency: form.frequency,
      day_of_month: Number(form.day_of_month) || 1,
      category_id: form.category_id || null,
      start_date: form.start_date,
      active: true,
    });
    toast.success("Recorrência configurada");
    setForm({ ...form, description: "", amount: "" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receitas e despesas recorrentes</DialogTitle>
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
            <Label>Valor (R$)</Label>
            <Input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              value={form.kind}
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value as "income" | "expense", category_id: "" })
              }
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="expense">Despesa</option>
              <option value="income">Receita</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Frequência</Label>
            <select
              value={form.frequency}
              onChange={(e) =>
                setForm({ ...form, frequency: e.target.value as typeof form.frequency })
              }
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Dia do mês</Label>
            <Input
              inputMode="numeric"
              value={form.day_of_month}
              onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Sem categoria</option>
              {activeCategories(categories)
                .filter((c) => c.kind === form.kind)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Início</Label>
            <DateField
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </div>
        </div>

        {rules.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="label-caps">Recorrências ativas</p>
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-border p-3 text-sm"
              >
                <span>
                  {r.description}
                  <span className="ml-2 text-xs text-muted-foreground">
                    dia {r.day_of_month} ·{" "}
                    {r.frequency === "monthly"
                      ? "mensal"
                      : r.frequency === "weekly"
                        ? "semanal"
                        : "anual"}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={`font-mono text-xs font-semibold ${
                      r.kind === "income" ? "text-positive" : "text-negative"
                    }`}
                  >
                    {brl(r.amount)}
                  </span>
                  <button
                    onClick={() => remove.mutate(r.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remover recorrência"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button onClick={save} disabled={upsert.isPending}>
            Adicionar recorrência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
