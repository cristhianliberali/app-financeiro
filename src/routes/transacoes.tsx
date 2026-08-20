import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Repeat, Search, Sparkles, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TransactionDialog } from "@/components/TransactionDialog";
import { AiImportDialog } from "@/components/AiImportDialog";
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
  const [aiOpen, setAiOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const catMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const numeric = Number(q.replace(",", "."));
    return transactions.filter((t) => {
      if (categoryFilter && t.category_id !== categoryFilter) return false;
      if (!q) return true;
      if (t.description.toLowerCase().includes(q)) return true;
      if (!Number.isNaN(numeric) && q.length > 0 && Math.abs(t.amount - numeric) < 0.01) return true;
      return false;
    });
  }, [transactions, query, categoryFilter]);

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
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles /> Importar com IA
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
      <h1 className="text-2xl font-bold tracking-tight">Centro de transações</h1>

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descrição ou valor exato…"
            className="pl-9"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-card px-3 text-sm md:w-56"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="label-caps">Entradas no filtro</p>
          <p className="mt-2 font-mono text-xl font-bold text-positive">{brl(totals.income)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="label-caps">Saídas no filtro</p>
          <p className="mt-2 font-mono text-xl font-bold text-negative">{brl(totals.expense)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="label-caps">Resultado</p>
          <p className="mt-2 font-mono text-xl font-bold">{brl(totals.income - totals.expense)}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-bold">
            {filtered.length} lançamento{filtered.length === 1 ? "" : "s"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Período filtrado por {dateBasis === "due_date" ? "data de vencimento" : "data da transação"}
          </p>
        </div>
        <div className="divide-y divide-border">
          {filtered.map((t) => {
            const cat = t.category_id ? catMap[t.category_id] : undefined;
            return (
              <div key={t.id} className="flex items-center gap-4 px-6 py-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm"
                  style={{ backgroundColor: `${cat?.color ?? "#94A3B8"}20` }}
                >
                  {cat?.emoji ?? (t.kind === "income" ? "💰" : "💸")}
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setEditing(t);
                    setDialog(t.kind);
                  }}
                >
                  <p className="truncate text-sm font-medium">
                    {t.description}
                    {t.installment_total ? (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                        {t.installment_no}/{t.installment_total}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {cat?.name ?? "Sem categoria"} · transação {formatDateBR(t.transaction_date)} ·
                    vence {formatDateBR(t.due_date)}
                  </p>
                </button>
                <span className="hidden text-[11px] text-muted-foreground sm:block">
                  {t.status === "paid" ? "Pago" : "Pendente"}
                </span>
                <span
                  className={`flex items-center gap-1 font-mono text-sm font-semibold ${
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
                  className="text-muted-foreground transition-colors hover:text-destructive"
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
      </div>

      <TransactionDialog
        open={dialog !== null}
        onOpenChange={(v) => !v && setDialog(null)}
        kind={dialog ?? "expense"}
        editing={editing}
      />
      <AiImportDialog open={aiOpen} onOpenChange={setAiOpen} />
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} />
    </AppShell>
  );
}
