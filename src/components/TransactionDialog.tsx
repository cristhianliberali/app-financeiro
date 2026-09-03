import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { CategorySelect } from "@/components/CategorySelect";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { activeCategories, useCategories, useUpsert, type Transaction } from "@/lib/data";
import { brl, toISODate, formatDateBR } from "@/lib/format";
import { MAX_INSTALLMENTS, buildInstallments, installmentLabel } from "@/lib/installments";

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
    /** Liga os campos de parcelamento. */
    installmentMode: false,
    installments: "2",
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
        // Editar mexe numa parcela específica, não no parcelamento inteiro.
        installmentMode: false,
        installments: String(editing.installment_total ?? 2),
        notes: editing.notes ?? "",
      });
    } else {
      setForm((f) => ({
        ...f,
        description: "",
        amount: "",
        notes: "",
        installmentMode: false,
        installments: "2",
      }));
    }
  }, [editing, open]);

  // Arquivadas ficam de fora: elas seguem nos lançamentos antigos, mas não
  // recebem lançamento novo.
  const options = activeCategories(categories ?? []).filter((c) => c.kind === kind);

  const installmentCount = Math.min(
    MAX_INSTALLMENTS,
    Math.max(2, Math.trunc(Number(form.installments) || 0)),
  );
  const parsedAmount = Number(form.amount.replace(",", ".")) || 0;
  /** O que será gravado, mostrado no formulário antes de salvar. */
  const preview =
    form.installmentMode && parsedAmount > 0
      ? buildInstallments({
          total: parsedAmount,
          count: installmentCount,
          firstDueDate: form.due_date,
        })
      : [];

  async function save() {
    const amount = Number(form.amount.replace(",", "."));
    if (!form.description || !amount) {
      toast.error("Informe descrição e valor");
      return;
    }
    // Sem categoria o lançamento não aparece em teto, gráfico nem comparação de
    // mês: ele viraria um valor solto no extrato. O servidor recusa igual.
    if (!form.category_id) {
      toast.error("Escolha uma categoria para o lançamento");
      return;
    }
    const base = {
      profile_id: profileId,
      category_id: form.category_id,
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
      } else if (form.installmentMode) {
        // O valor informado é o da compra inteira: a divisão fecha na soma, e o
        // nome de cada parcela sai no padrão "DESCRIÇÃO k/n".
        const group = crypto.randomUUID();
        const parts = buildInstallments({
          total: amount,
          count: installmentCount,
          firstDueDate: form.due_date,
        });
        await upsert.mutateAsync(
          parts.map((part) => ({
            ...base,
            description: installmentLabel(form.description, part.no, part.total),
            amount: part.amount,
            transaction_date: form.transaction_date,
            due_date: part.due_date,
            installment_no: part.no,
            installment_total: part.total,
            installment_group: group,
          })),
        );
      } else {
        await upsert.mutateAsync({
          ...base,
          description: form.description,
          amount,
          transaction_date: form.transaction_date,
          due_date: form.due_date,
        });
      }
      toast.success(
        editing
          ? "Lançamento atualizado"
          : form.installmentMode
            ? `${installmentCount} parcelas registradas`
            : "Lançamento registrado",
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar lançamento" : kind === "income" ? "Nova receita" : "Nova despesa"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tx-descricao">Descrição</Label>
            <Input
              id="tx-descricao"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-valor">Valor total (R$)</Label>
            <Input
              id="tx-valor"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-categoria">Categoria</Label>
            <CategorySelect
              id="tx-categoria"
              categories={options}
              value={form.category_id}
              onChange={(category_id) => setForm({ ...form, category_id })}
            />
            {options.length === 0 && (
              <p className="text-[11px] text-negative">
                Nenhuma categoria de {kind === "income" ? "receita" : "despesa"} ativa. Crie uma em
                Categorias antes de lançar.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-data">Data da transação</Label>
            <DateField
              id="tx-data"
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              {form.installmentMode ? "Vencimento da 1ª parcela" : "Vencimento / pagamento"}
            </Label>
            <DateField
              id="tx-vencimento"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
          {!editing && (
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <Label htmlFor="parcelado" className="cursor-pointer">
                  Lançamento parcelado
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    Divide o valor total da compra e agenda uma parcela por mês.
                  </span>
                </Label>
                <Switch
                  id="parcelado"
                  checked={form.installmentMode}
                  onCheckedChange={(checked) => setForm({ ...form, installmentMode: checked })}
                />
              </div>

              {form.installmentMode && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="quantidade-parcelas">Quantidade de parcelas</Label>
                    <Input
                      id="quantidade-parcelas"
                      type="number"
                      min={2}
                      max={MAX_INSTALLMENTS}
                      value={form.installments}
                      onChange={(e) => setForm({ ...form, installments: e.target.value })}
                      className="w-32"
                    />
                  </div>

                  {preview.length > 0 ? (
                    <div className="space-y-1">
                      <p className="label-caps">O que será lançado</p>
                      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                        {preview.map((part) => (
                          <div
                            key={part.no}
                            className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5 text-xs"
                          >
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {part.no}/{part.total}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {installmentLabel(
                                form.description || "Lançamento",
                                part.no,
                                part.total,
                              )}
                            </span>
                            <span className="font-mono font-semibold tabular-nums">
                              {brl(part.amount)}
                            </span>
                            <span className="text-muted-foreground">
                              {formatDateBR(part.due_date)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Total:{" "}
                        <span className="font-medium text-foreground">{brl(parsedAmount)}</span> em{" "}
                        {preview.length}x · primeira em {formatDateBR(preview[0]!.due_date)}, última
                        em {formatDateBR(preview[preview.length - 1]!.due_date)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Informe o valor total da compra para ver as parcelas.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tx-status">Status</Label>
            <select
              id="tx-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as "paid" | "pending" })}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
            >
              <option value="pending">Agendado</option>
              <option value="paid">{kind === "income" ? "Recebido" : "Pago"}</option>
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tx-observacoes">Observações</Label>
            <Textarea
              id="tx-observacoes"
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
          <Button onClick={save} disabled={upsert.isPending || !form.category_id}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
