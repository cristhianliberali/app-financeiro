import { useMemo, useState } from "react";
import { toast } from "sonner";
import { History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/lib/app-state";
import { activeCategories, useCategories, useRecurring, useRemove, useUpsert } from "@/lib/data";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { MAX_RECURRING_BACKFILL, occurrencesUntil } from "@/lib/recurring";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export function RecurringDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const { data: rules = [] } = useRecurring(profileId);
  const upsert = useUpsert("recurring_rules");
  const upsertTransactions = useUpsert("transactions");
  const remove = useRemove("recurring_rules");

  const today = toISODate(new Date());

  const [form, setForm] = useState({
    description: "",
    amount: "",
    kind: "expense" as "income" | "expense",
    frequency: "monthly" as "monthly" | "weekly" | "yearly",
    day_of_month: "5",
    category_id: "",
    start_date: today,
  });
  /** Confirmação do retroativo: fica aberta com as datas que serão gravadas. */
  const [backfill, setBackfill] = useState<string[] | null>(null);
  /** No passado, boa parte já foi paga; quem sabe disso é quem está cadastrando. */
  const [markPaid, setMarkPaid] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * As cobranças que a regra já teria feito se existisse desde o início.
   *
   * Calculado enquanto se digita, e não só ao salvar: quem escolhe uma data
   * antiga vê na hora quantos lançamentos aquilo significa.
   */
  const pending = useMemo(
    () =>
      form.start_date < today
        ? occurrencesUntil(
            {
              frequency: form.frequency,
              day_of_month: Number(form.day_of_month) || 1,
              start_date: form.start_date,
            },
            today,
          )
        : [],
    [form.start_date, form.frequency, form.day_of_month, today],
  );

  function validate(): boolean {
    if (!form.description || !form.amount) {
      toast.error("Preencha descrição e valor");
      return false;
    }
    // A recorrência vira lançamento, e lançamento sem categoria não entra.
    if (!form.category_id) {
      toast.error("Escolha uma categoria para a recorrência");
      return false;
    }
    return true;
  }

  /**
   * Grava a regra e, quando pedido, os lançamentos que ela já teria feito.
   *
   * A ordem importa: a regra primeiro. Se a gravação dos retroativos falhar no
   * meio, a recorrência ainda ficou configurada — e o que faltou é visível na
   * lista de transações, em vez de sumir junto.
   */
  async function save(dates: string[]) {
    const amount = Number(form.amount.replace(",", "."));
    setSaving(true);
    try {
      await upsert.mutateAsync({
        profile_id: profileId,
        description: form.description,
        amount,
        kind: form.kind,
        frequency: form.frequency,
        day_of_month: Number(form.day_of_month) || 1,
        category_id: form.category_id,
        start_date: form.start_date,
        active: true,
      });

      if (dates.length > 0) {
        await upsertTransactions.mutateAsync(
          dates.map((date) => ({
            profile_id: profileId,
            category_id: form.category_id,
            description: form.description,
            amount,
            kind: form.kind,
            transaction_date: date,
            due_date: date,
            status: markPaid ? "paid" : "pending",
          })),
        );
        toast.success(
          `Recorrência configurada · ${dates.length} lançamento${dates.length === 1 ? "" : "s"} retroativo${
            dates.length === 1 ? "" : "s"
          } gerado${dates.length === 1 ? "" : "s"}`,
        );
      } else {
        toast.success("Recorrência configurada");
      }

      setForm({ ...form, description: "", amount: "" });
      setBackfill(null);
      setMarkPaid(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  /** Data no passado nunca grava direto: ela sempre passa pela confirmação. */
  function requestSave() {
    if (!validate()) return;
    if (pending.length > 0) setBackfill(pending);
    else void save([]);
  }

  const previewAmount = Number(form.amount.replace(",", ".")) || 0;
  const options = activeCategories(categories).filter((c) => c.kind === form.kind);

  return (
    <>
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
                  setForm({
                    ...form,
                    kind: e.target.value as "income" | "expense",
                    category_id: "",
                  })
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
                disabled={form.frequency !== "monthly"}
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
                <option value="">Escolha uma categoria…</option>
                {options.map((c) => (
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

          {/*
            Aviso do retroativo, ainda no formulário: quem escolhe uma data
            antiga descobre o tamanho da conta antes de clicar em salvar, não
            num diálogo que aparece de surpresa depois.
          */}
          {pending.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
              <History className="mt-0.5 size-3.5 shrink-0" />
              <span>
                O início é anterior a hoje: esta regra já teria cobrado{" "}
                <span className="font-semibold text-foreground">
                  {pending.length} {pending.length === 1 ? "vez" : "vezes"}
                </span>
                , de {formatDateBR(pending[0]!)} a {formatDateBR(pending[pending.length - 1]!)}. Ao
                salvar, você escolhe se esses lançamentos são gerados.
              </span>
            </p>
          )}

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
            <Button onClick={requestSave} disabled={upsert.isPending || saving}>
              Adicionar recorrência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Confirmação do retroativo. Gerar dezenas de lançamentos mexe em saldo,
        teto de categoria e lista de pendências de uma vez só — por isso a tela
        mostra quantos, quanto e até quando antes de qualquer gravação, e a
        saída "só a recorrência" fica no mesmo lugar, não escondida.
      */}
      <AlertDialog open={!!backfill} onOpenChange={(v) => !v && setBackfill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Gerar {backfill?.length ?? 0} lançamento{backfill?.length === 1 ? "" : "s"} anterior
              {backfill?.length === 1 ? "" : "es"} a hoje?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  “{form.description}” começa em{" "}
                  <span className="font-semibold text-foreground">
                    {formatDateBR(form.start_date)}
                  </span>
                  , no passado. Podemos criar agora as cobranças que já teriam acontecido — de{" "}
                  {backfill && backfill.length > 0 ? formatDateBR(backfill[0]!) : "—"} a{" "}
                  {backfill && backfill.length > 0
                    ? formatDateBR(backfill[backfill.length - 1]!)
                    : "—"}
                  , somando{" "}
                  <span className="font-semibold text-foreground">
                    {brl(previewAmount * (backfill?.length ?? 0))}
                  </span>
                  .
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-3 text-xs">
                  {(backfill ?? []).map((date) => (
                    <li key={date} className="flex items-center justify-between gap-3">
                      <span>{formatDateBR(date)}</span>
                      <span
                        className={`shrink-0 font-mono font-semibold ${
                          form.kind === "income" ? "text-positive" : "text-negative"
                        }`}
                      >
                        {brl(previewAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
                {backfill?.length === MAX_RECURRING_BACKFILL && (
                  <p className="text-negative">
                    A lista foi cortada em {MAX_RECURRING_BACKFILL} lançamentos. Confira a data de
                    início antes de continuar.
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={markPaid}
                    onCheckedChange={(checked) => setMarkPaid(checked === true)}
                  />
                  <span className="text-xs">
                    Marcar como já {form.kind === "income" ? "recebidos" : "pagos"}
                    <span className="mt-0.5 block text-muted-foreground">
                      Sem isso, eles entram como agendados e aparecem em Transações pendentes, onde
                      dá para baixar o que já foi quitado.
                    </span>
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <Button variant="outline" disabled={saving} onClick={() => void save([])}>
              Só a recorrência
            </Button>
            <Button disabled={saving} onClick={() => void save(backfill ?? [])}>
              {saving ? "Gerando…" : `Gerar ${backfill?.length ?? 0} lançamentos`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
