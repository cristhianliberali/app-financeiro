import { useState } from "react";
import { toast } from "sonner";
import { Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CategorySelect } from "@/components/CategorySelect";
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
import {
  activeCategories,
  useCategories,
  useRecurring,
  useRecurringImpact,
  useRemoveRecurring,
  useSaveRecurring,
  type RecurringRule,
} from "@/lib/data";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { RECURRING_HORIZON_MONTHS } from "@/lib/recurring";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

/** O que acontece com os lançamentos já criados quando a regra sai. */
type DeleteScope = "all" | "future" | "keep";

export function RecurringDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const { data: rules = [] } = useRecurring(profileId);
  const save = useSaveRecurring();
  const impact = useRecurringImpact();
  const remove = useRemoveRecurring();

  const today = toISODate(new Date());

  const [form, setForm] = useState({
    description: "",
    amount: "",
    kind: "expense" as "income" | "expense",
    frequency: "monthly" as "monthly" | "weekly" | "yearly",
    day_of_month: "5",
    category_id: "",
    start_date: today,
    variable_amount: false,
  });

  /** Regra em vias de ser excluída, com o retrato do que ela criou. */
  const [confirming, setConfirming] = useState<{
    rule: RecurringRule;
    total: number;
    futuros: number;
    liquidados: number;
  } | null>(null);
  const [scope, setScope] = useState<DeleteScope>("future");

  const options = activeCategories(categories).filter((c) => c.kind === form.kind);

  async function submit() {
    if (!form.description.trim() || !form.amount) {
      toast.error("Preencha descrição e valor");
      return;
    }
    if (!form.category_id) {
      toast.error("Escolha uma categoria para a recorrência");
      return;
    }
    if (!profileId) return;

    try {
      const { created } = await save.mutateAsync({
        profileId,
        categoryId: form.category_id,
        description: form.description.trim(),
        amount: Number(form.amount.replace(",", ".")),
        variableAmount: form.variable_amount,
        kind: form.kind,
        frequency: form.frequency,
        dayOfMonth: Number(form.day_of_month) || 1,
        startDate: form.start_date,
      });
      toast.success(
        created > 0
          ? `Recorrência criada · ${created} lançamento${created === 1 ? "" : "s"} gerado${
              created === 1 ? "" : "s"
            }`
          : "Recorrência criada",
      );
      setForm({ ...form, description: "", amount: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar");
    }
  }

  /** Abre a confirmação já sabendo o tamanho do estrago. */
  async function askDelete(rule: RecurringRule) {
    try {
      const found = await impact.mutateAsync(rule.id);
      setScope(found.futuros > 0 ? "future" : "keep");
      setConfirming({ rule, ...found });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a recorrência");
    }
  }

  async function confirmDelete() {
    if (!confirming) return;
    const { rule } = confirming;
    try {
      const { removed } = await remove.mutateAsync({ id: rule.id, scope });
      toast.success(
        removed > 0
          ? `Recorrência excluída · ${removed} lançamento${removed === 1 ? "" : "s"} apagado${
              removed === 1 ? "" : "s"
            }`
          : "Recorrência excluída · os lançamentos foram mantidos",
      );
      setConfirming(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir");
    }
  }

  const escolhas: Array<{ value: DeleteScope; titulo: string; detalhe: string; perigo?: boolean }> =
    confirming
      ? [
          {
            value: "future",
            titulo: `Apagar as futuras (${confirming.futuros})`,
            detalhe:
              "Some o que ainda vai vencer, a partir de amanhã. O que já venceu continua no " +
              "extrato — inclusive o de hoje, que pode já ter sido pago.",
          },
          {
            value: "all",
            titulo: `Apagar todas (${confirming.total})`,
            detalhe:
              confirming.liquidados > 0
                ? `Some tudo o que esta recorrência criou, incluindo ${confirming.liquidados} já ` +
                  "liquidado(s). O histórico desses pagamentos vai junto."
                : "Some tudo o que esta recorrência criou, passado e futuro.",
            perigo: true,
          },
          {
            value: "keep",
            titulo: "Manter todos os lançamentos",
            detalhe:
              "Só a regra sai; os lançamentos ficam e viram lançamentos comuns. É o caso de um " +
              "contrato encerrado, em que o histórico precisa continuar de pé.",
          },
        ]
      : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receitas e despesas recorrentes</DialogTitle>
          </DialogHeader>

          <p className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
            <Repeat className="mt-0.5 size-3.5 shrink-0" />
            Ao salvar, os lançamentos são criados de uma vez: do início da recorrência até{" "}
            {RECURRING_HORIZON_MONTHS} meses à frente. Daí em diante a série se completa sozinha,
            então o que está por vir sempre aparece nas transações e nas pendências.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rec-descricao">Descrição</Label>
              <Input
                id="rec-descricao"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-valor">
                {form.variable_amount ? "Valor estimado (R$)" : "Valor (R$)"}
              </Label>
              <Input
                id="rec-valor"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
              {/*
                Água, luz, cartão: o valor muda todo mês e ninguém sabe qual é
                até a conta chegar. Marcando aqui, o valor acima deixa de ser o
                valor e passa a ser a estimativa com que cada mês nasce — o
                número de verdade é confirmado uma vez, na hora de dar baixa.
                Sem a marca, aluguel e mensalidade continuam fechando sozinhos,
                sem interromper ninguém com uma pergunta todo mês.
              */}
              <label className="flex cursor-pointer items-start gap-2 pt-1">
                <Checkbox
                  checked={form.variable_amount}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, variable_amount: checked === true })
                  }
                  aria-label="O valor varia a cada ocorrência"
                />
                <span className="text-xs leading-tight">
                  <span className="font-medium">O valor varia a cada mês</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Ao dar baixa, o app pede o valor real daquela conta.
                  </span>
                </span>
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-tipo">Tipo</Label>
              <select
                id="rec-tipo"
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
              <Label htmlFor="rec-frequencia">Frequência</Label>
              <select
                id="rec-frequencia"
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
              <Label htmlFor="rec-dia">Dia do mês</Label>
              <Input
                id="rec-dia"
                inputMode="numeric"
                value={form.day_of_month}
                disabled={form.frequency !== "monthly"}
                onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-categoria">Categoria</Label>
              <CategorySelect
                id="rec-categoria"
                categories={options}
                value={form.category_id}
                onChange={(category_id) => setForm({ ...form, category_id })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Início</Label>
              <DateField
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
              {form.start_date < today && (
                <p className="text-[11px] text-muted-foreground">
                  Início no passado: as cobranças de {formatDateBR(form.start_date)} até hoje também
                  serão lançadas, como agendadas.
                </p>
              )}
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
                      {r.frequency === "monthly"
                        ? `dia ${r.day_of_month} · mensal`
                        : r.frequency === "weekly"
                          ? "semanal"
                          : "anual"}{" "}
                      · desde {formatDateBR(r.start_date)}
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
                      onClick={() => void askDelete(r)}
                      disabled={impact.isPending}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      aria-label={`Excluir recorrência ${r.description}`}
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
            <Button onClick={() => void submit()} disabled={save.isPending}>
              {save.isPending ? "Criando lançamentos…" : "Adicionar recorrência"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Excluir uma recorrência mexe em dezenas de lançamentos de uma vez, e as
        três saídas querem coisas diferentes: parar de cobrar daqui para a
        frente, apagar o registro inteiro, ou tirar só a regra do caminho. Cada
        opção mostra quantos lançamentos ela alcança — sem esse número, a
        escolha seria no escuro.
      */}
      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{confirming?.rule.description}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Esta recorrência criou{" "}
                  <span className="font-semibold text-foreground">
                    {confirming?.total ?? 0} lançamento(s)
                  </span>
                  , dos quais {confirming?.futuros ?? 0} ainda vão vencer. Escolha o que fazer com
                  eles:
                </p>
                <div className="space-y-2">
                  {escolhas.map((escolha) => (
                    <label
                      key={escolha.value}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
                        scope === escolha.value
                          ? "border-primary bg-primary-soft/40"
                          : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="escopo-exclusao"
                        className="mt-0.5"
                        checked={scope === escolha.value}
                        onChange={() => setScope(escolha.value)}
                      />
                      <span className="text-xs">
                        <span
                          className={`block font-semibold ${
                            escolha.perigo ? "text-negative" : "text-foreground"
                          }`}
                        >
                          {escolha.titulo}
                        </span>
                        <span className="mt-0.5 block text-muted-foreground">
                          {escolha.detalhe}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <Button
              variant={scope === "all" ? "destructive" : "default"}
              disabled={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {remove.isPending ? "Excluindo…" : "Excluir recorrência"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
