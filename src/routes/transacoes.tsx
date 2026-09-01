import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, FileScan, Repeat, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";
import { StatusPill } from "@/components/ui/status";
import { PaginationBar, usePagination } from "@/components/PaginationBar";
import { TransactionDialog } from "@/components/TransactionDialog";
import { RecurringDialog } from "@/components/RecurringDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppState } from "@/lib/app-state";
import { useCategories, useRemove, useTransactions, type Transaction } from "@/lib/data";
import { brl, formatDateBR } from "@/lib/format";

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

/** Os três recortes por natureza do lançamento. */
const KIND_FILTERS = [
  { value: "", label: "Entradas e saídas" },
  { value: "income", label: "Só entradas" },
  { value: "expense", label: "Só saídas" },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]["value"];

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

  const [dialog, setDialog] = useState<null | "income" | "expense">(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("");
  const [categoryFilter, setCategoryFilter] = useState("");

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
        <select
          value={kindFilter}
          onChange={(e) => {
            const next = e.target.value as KindFilter;
            setKindFilter(next);
            // Categoria pertence a um tipo só. Manter uma de despesa escolhida
            // com "só entradas" esvaziaria a lista sem dizer por quê.
            if (next && categoryFilter && catMap[categoryFilter]?.kind !== next) {
              setCategoryFilter("");
            }
          }}
          className={`${SELECT_CLASS} md:w-44`}
          aria-label="Filtrar por entrada ou saída"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className={`${SELECT_CLASS} md:w-56`}
          aria-label="Filtrar por categoria"
        >
          <option value="">Todas as categorias</option>
          {/* Arquivadas continuam aqui: elas ainda têm lançamentos para filtrar.
              Com um tipo escolhido, só as daquele tipo — as outras não teriam o
              que filtrar. */}
          {categories
            .filter((c) => !kindFilter || c.kind === kindFilter)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived_at ? " (arquivada)" : ""}
              </option>
            ))}
        </select>
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

      <div className="panel overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-base font-bold tracking-tight">
            {filtered.length} lançamento{filtered.length === 1 ? "" : "s"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Período filtrado por{" "}
            {dateBasis === "due_date" ? "data de vencimento" : "data da transação"}
          </p>
        </div>
        <div className="divide-y divide-border">
          {pagination.visible.map((t) => {
            const cat = t.category_id ? catMap[t.category_id] : undefined;
            return (
              <div
                key={t.id}
                className={`state-bar flex items-center gap-4 px-6 py-3 transition-colors hover:bg-accent/40 ${
                  t.status === "paid" ? "state-done" : "state-pending"
                }`}
              >
                <IconBadge
                  name={cat?.emoji}
                  color={cat?.color}
                  fallback={t.kind === "income" ? "banknote" : DEFAULT_CATEGORY_ICON}
                />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setEditing(t);
                    setDialog(t.kind);
                  }}
                >
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
                <button
                  onClick={() => remove.mutate(t.id)}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative-soft hover:text-destructive"
                  aria-label="Excluir lançamento"
                >
                  <Trash2 className="size-4" />
                </button>
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
