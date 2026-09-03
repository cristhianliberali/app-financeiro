import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  FileScan,
  Pencil,
  Repeat,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { CategorySelect } from "@/components/CategorySelect";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";
import { StatusPill } from "@/components/ui/status";
import { PaginationBar, usePagination } from "@/components/PaginationBar";
import { TransactionDialog } from "@/components/TransactionDialog";
import { RecurringDialog } from "@/components/RecurringDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/lib/app-state";
import {
  useCategories,
  useRemove,
  useRemoveMany,
  useTransactions,
  useUpsert,
  type Transaction,
} from "@/lib/data";
import { brl, formatDateBR, toISODate } from "@/lib/format";

export const Route = createFileRoute("/transacoes")({
  head: () => ({
    meta: [
      { title: "Centro de transações — Aura Finanças" },
      {
        name: "description",
        content:
          "Lance receitas e despesas, configure recorrências, importe faturas com IA e busque por descrição ou valor.",
      },
      { property: "og:title", content: "Centro de transações — Aura Finanças" },
      {
        property: "og:description",
        content: "Lançamentos, recorrências, importação inteligente de faturas e busca avançada.",
      },
    ],
  }),
  component: TransactionsPage,
});

const SELECT_CLASS =
  "h-11 rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none " +
  "transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

/**
 * Os três recortes por natureza do lançamento.
 *
 * Botões lado a lado, e não uma lista suspensa: são três opções fixas, o que
 * está escolhido fica à vista sem abrir nada, e trocar custa um clique em vez
 * de dois. O "Só" saiu dos rótulos — ao lado de "Tudo", "Entradas" já quer
 * dizer só entradas, e a seta diz para que lado o dinheiro anda.
 */
const KIND_FILTERS = [
  { value: "", label: "Tudo", icon: null, tone: "text-foreground" },
  { value: "income", label: "Entradas", icon: ArrowUpRight, tone: "text-positive" },
  { value: "expense", label: "Saídas", icon: ArrowDownRight, tone: "text-negative" },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]["value"];

/** Qual data o ajuste em massa reescreve. */
const BULK_DATE_FIELDS = [
  { value: "due_date", label: "Vencimento" },
  { value: "transaction_date", label: "Data da transação" },
  { value: "both", label: "As duas datas" },
] as const;

type BulkDateField = (typeof BULK_DATE_FIELDS)[number]["value"];

function TransactionsPage() {
  const { profileId, from, to, dateBasis } = useAppState();
  const { data: transactions = [] } = useTransactions({
    profileId,
    from,
    to,
    basis: dateBasis,
  });
  const { data: categories = [] } = useCategories(profileId);
  const remove = useRemove("transactions");
  const removeMany = useRemoveMany("transactions");
  const upsert = useUpsert("transactions");

  const [dialog, setDialog] = useState<null | "income" | "expense">(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkDateField>("due_date");
  const [bulkDate, setBulkDate] = useState(() => toISODate(new Date()));
  const [confirmingDelete, setConfirmingDelete] = useState<Transaction[] | null>(null);

  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const numeric = Number(q.replace(",", "."));
    return transactions.filter((t) => {
      if (kindFilter && t.kind !== kindFilter) return false;
      if (categoryFilter && t.category_id !== categoryFilter) return false;
      if (!q) return true;
      if (t.description.toLowerCase().includes(q)) return true;
      if (!Number.isNaN(numeric) && q.length > 0 && Math.abs(t.amount - numeric) < 0.01)
        return true;
      return false;
    });
  }, [transactions, query, kindFilter, categoryFilter]);

  // A paginação é do que sobrou dos filtros: os totais acima continuam somando
  // o período inteiro, não só a página exibida.
  const pagination = usePagination(filtered, "aura.transacoes.pageSize");

  /**
   * A seleção só conta o que está na tela.
   *
   * Guardar ids que os filtros escondem faria uma ação em massa alcançar linhas
   * que a pessoa não está vendo — que é exatamente o tipo de surpresa que não se
   * desfaz com um clique.
   */
  const chosen = useMemo(() => filtered.filter((t) => selected.has(t.id)), [filtered, selected]);

  const visibleIds = pagination.visible.map((t) => t.id);
  const pageAllChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const pageSomeChecked = visibleIds.some((id) => selected.has(id));

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(list: Transaction[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const t of list) {
        if (checked) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  }

  /**
   * Aplica a mudança e deixa o caminho de volta aberto.
   *
   * Todo ajuste em massa guarda o valor anterior de cada linha antes de gravar:
   * é o que permite oferecer "desfazer" de verdade, e não um desfazer que
   * chuta um estado comum para todas elas.
   */
  async function applyBulk(
    list: Transaction[],
    changes: (t: Transaction) => Record<string, unknown>,
    previous: (t: Transaction) => Record<string, unknown>,
    message: string,
  ) {
    if (list.length === 0) return;
    const antes = list.map((t) => ({ id: t.id, ...previous(t) }));
    try {
      await upsert.mutateAsync(list.map((t) => ({ id: t.id, ...changes(t) })));
      toast.success(message, {
        position: "bottom-right",
        duration: 8000,
        action: {
          label: "Desfazer",
          onClick: () => {
            void upsert
              .mutateAsync(antes)
              .then(() => toast.info("Ajuste desfeito", { position: "bottom-right" }));
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ajustar");
    }
  }

  function setStatus(status: "paid" | "pending") {
    void applyBulk(
      chosen,
      () => ({ status }),
      (t) => ({ status: t.status }),
      `${chosen.length} lançamento(s) marcado(s) como ${status === "paid" ? "pago" : "pendente"}`,
    );
  }

  function applyDate() {
    if (!bulkDate) {
      toast.error("Escolha a data a aplicar");
      return;
    }
    const rotulo = BULK_DATE_FIELDS.find((f) => f.value === bulkField)!.label.toLowerCase();
    void applyBulk(
      chosen,
      () =>
        bulkField === "both"
          ? { transaction_date: bulkDate, due_date: bulkDate }
          : { [bulkField]: bulkDate },
      (t) =>
        bulkField === "both"
          ? { transaction_date: t.transaction_date, due_date: t.due_date }
          : { [bulkField]: t[bulkField] },
      `${chosen.length} lançamento(s) com ${rotulo} em ${formatDateBR(bulkDate)}`,
    );
  }

  async function confirmBulkDelete() {
    const list = confirmingDelete ?? [];
    setConfirmingDelete(null);
    try {
      const { removed } = await removeMany.mutateAsync(list.map((t) => t.id));
      setSelected(new Set());
      toast.success(`${removed} lançamento(s) excluído(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir");
    }
  }

  function edit(t: Transaction) {
    setEditing(t);
    setDialog(t.kind);
  }

  const totals = filtered.reduce(
    (acc, t) => {
      if (t.kind === "income") acc.income += t.amount;
      else acc.expense += t.amount;
      return acc;
    },
    { income: 0, expense: 0 },
  );

  return (
    <AppShell
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRecurringOpen(true)}>
            <Repeat /> Recorrentes
          </Button>
          {/* A importação é tela, não janela: ela guarda a revisão em aberto. */}
          <Button size="sm" variant="outline" asChild>
            <Link to="/importar">
              <FileScan /> Importar com IA
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setDialog("income");
            }}
          >
            + Receita
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialog("expense");
            }}
          >
            + Despesa
          </Button>
        </div>
      }
    >
      <h1 className="title-xl">Centro de transações</h1>

      <div className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descrição ou valor exato…"
            className="pl-9"
          />
        </div>
        {/*
          Entrada ou saída, antes da categoria: é o corte mais grosso e o mais
          usado — "quanto saiu neste mês" não pede categoria nenhuma.
        */}
        <div
          role="group"
          aria-label="Filtrar por entrada ou saída"
          className="flex h-11 shrink-0 items-center gap-0.5 rounded-xl border border-input bg-secondary p-1 shadow-xs"
        >
          {KIND_FILTERS.map((f) => {
            const on = f.value === kindFilter;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setKindFilter(f.value);
                  // Categoria pertence a um tipo só. Manter uma de despesa
                  // escolhida com "entradas" esvaziaria a lista sem dizer por quê.
                  if (f.value && categoryFilter && catMap[categoryFilter]?.kind !== f.value) {
                    setCategoryFilter("");
                  }
                }}
                className={`flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all ${
                  on
                    ? `bg-card shadow-xs ring-1 ring-border ${f.tone}`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.icon && <f.icon className="size-3.5" />}
                {f.label}
              </button>
            );
          })}
        </div>
        <CategorySelect
          className="md:w-56"
          categories={categories}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="Todas as categorias"
          allowEmpty
          aria-label="Filtrar por categoria"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel state-bar state-done p-5">
          <p className="label-caps">Entradas no filtro</p>
          <p className="stat-figure mt-2 text-positive">{brl(totals.income)}</p>
        </div>
        <div className="panel state-bar state-late p-5">
          <p className="label-caps">Saídas no filtro</p>
          <p className="stat-figure mt-2 text-negative">{brl(totals.expense)}</p>
        </div>
        <div className="panel state-bar state-pending p-5">
          <p className="label-caps">Resultado</p>
          <p className="stat-figure mt-2">{brl(totals.income - totals.expense)}</p>
        </div>
      </div>

      {/*
        Barra da seleção, grudada abaixo do cabeçalho: selecionar trinta linhas
        e ter de voltar ao topo para agir seria o mesmo que não ter seleção.
      */}
      {chosen.length > 0 && (
        <div className="sticky top-20 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary-soft p-3 shadow-lg backdrop-blur-xl">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CheckCheck className="size-4" strokeWidth={2.5} />
          </span>
          <p className="text-sm font-semibold text-primary-soft-foreground">
            {chosen.length} selecionada{chosen.length === 1 ? "" : "s"}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setStatus("paid")}>
              <Check strokeWidth={3} /> Pago
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStatus("pending")}>
              <Clock3 /> Pendente
            </Button>
          </div>

          {/* Mudar data em massa: qual data, para quando, aplicar. */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1.5">
            <select
              value={bulkField}
              onChange={(e) => setBulkField(e.target.value as BulkDateField)}
              className="h-8 rounded-lg border border-input bg-card px-2 text-xs font-medium"
              aria-label="Qual data alterar"
            >
              {BULK_DATE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <DateField
              type="date"
              className="h-8 w-36 text-xs"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              aria-label="Nova data"
            />
            <Button size="sm" variant="soft" onClick={applyDate} disabled={upsert.isPending}>
              Aplicar
            </Button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmingDelete(chosen)}
              disabled={removeMany.isPending}
            >
              <Trash2 /> Excluir
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X /> Limpar
            </Button>
          </div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
          <Checkbox
            checked={pageAllChecked ? true : pageSomeChecked ? "indeterminate" : false}
            onCheckedChange={(checked) => toggleMany(pagination.visible, checked === true)}
            disabled={pagination.visible.length === 0}
            aria-label="Selecionar os lançamentos desta página"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight">
              {filtered.length} lançamento{filtered.length === 1 ? "" : "s"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Período filtrado por{" "}
              {dateBasis === "due_date" ? "data de vencimento" : "data da transação"}
            </p>
          </div>
          {/*
            A caixa do cabeçalho marca a página, não a lista inteira: marcar
            trezentas linhas invisíveis num clique é fácil demais de fazer sem
            querer. Quem quer todas pede, e o número aparece antes.
          */}
          {pageAllChecked && filtered.length > pagination.visible.length && (
            <button
              onClick={() => toggleMany(filtered, chosen.length !== filtered.length)}
              className="text-xs font-semibold text-primary underline underline-offset-2"
            >
              {chosen.length === filtered.length
                ? "Desmarcar todos"
                : `Selecionar os ${filtered.length} do filtro`}
            </button>
          )}
        </div>
        <div className="divide-y divide-border">
          {pagination.visible.map((t) => {
            const cat = t.category_id ? catMap[t.category_id] : undefined;
            return (
              <div
                key={t.id}
                className={`state-bar flex items-center gap-4 px-6 py-3 transition-colors ${
                  selected.has(t.id) ? "bg-primary-soft/40" : "hover:bg-accent/40"
                } ${t.status === "paid" ? "state-done" : "state-pending"}`}
              >
                <Checkbox
                  checked={selected.has(t.id)}
                  onCheckedChange={() => toggleOne(t.id)}
                  aria-label={`Selecionar ${t.description}`}
                />
                <IconBadge
                  name={cat?.emoji}
                  color={cat?.color}
                  fallback={t.kind === "income" ? "banknote" : DEFAULT_CATEGORY_ICON}
                />
                <button className="min-w-0 flex-1 text-left" onClick={() => edit(t)}>
                  <p
                    className={`truncate text-sm font-semibold ${t.status === "paid" ? "text-muted-foreground" : ""}`}
                  >
                    {t.description}
                    {/* O selo só aparece quando o nome não traz a parcela: o padrão
                        "DESCRIÇÃO k/n" já diz isso, e repetir polui a linha. */}
                    {t.installment_total &&
                    !t.description.trim().endsWith(`${t.installment_no}/${t.installment_total}`) ? (
                      <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                        {t.installment_no}/{t.installment_total}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {cat?.name ?? "Sem categoria"} · transação {formatDateBR(t.transaction_date)} ·
                    vence {formatDateBR(t.due_date)}
                  </p>
                </button>
                <span className="hidden sm:block">
                  <StatusPill tone={t.status === "paid" ? "done" : "pending"}>
                    {t.status === "paid" ? "Pago" : "Pendente"}
                  </StatusPill>
                </span>
                <span
                  className={`flex items-center gap-1 font-mono text-sm font-bold ${
                    t.kind === "income" ? "text-positive" : "text-negative"
                  }`}
                >
                  {t.kind === "income" ? (
                    <ArrowUpRight className="size-3.5" />
                  ) : (
                    <ArrowDownLeft className="size-3.5" />
                  )}
                  {brl(t.amount)}
                </span>
                {/*
                  Editar já acontecia ao clicar na descrição, mas nada na linha
                  dizia isso. O lápis torna a edição individual visível ao lado
                  da exclusão, que é onde o olho procura por ela.
                */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => edit(t)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
                    aria-label={`Editar ${t.description}`}
                    title="Editar lançamento"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => remove.mutate(t.id)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative-soft hover:text-destructive"
                    aria-label={`Excluir ${t.description}`}
                    title="Excluir lançamento"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              Nenhum lançamento encontrado para os filtros atuais.
            </p>
          )}
        </div>
        <PaginationBar pagination={pagination} itemLabel="lançamentos" />
      </div>

      {/*
        Excluir em massa é a única ação da barra que não tem "desfazer" — por
        isso ela pergunta antes, e mostra o que vai embora.
      */}
      <AlertDialog
        open={!!confirmingDelete}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {confirmingDelete?.length ?? 0} lançamento
              {confirmingDelete?.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Isto não tem volta. O total afetado é{" "}
                  <span className="font-semibold text-foreground">
                    {brl((confirmingDelete ?? []).reduce((sum, t) => sum + t.amount, 0))}
                  </span>
                  .
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-3 text-xs">
                  {(confirmingDelete ?? []).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3">
                      <span className="truncate">{t.description}</span>
                      <span
                        className={`shrink-0 font-mono font-semibold ${
                          t.kind === "income" ? "text-positive" : "text-negative"
                        }`}
                      >
                        {brl(t.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmBulkDelete()}>
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TransactionDialog
        open={dialog !== null}
        onOpenChange={(v) => !v && setDialog(null)}
        kind={dialog ?? "expense"}
        editing={editing}
      />
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} />
    </AppShell>
  );
}
