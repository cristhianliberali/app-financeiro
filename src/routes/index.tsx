import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { TransactionDialog } from "@/components/TransactionDialog";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/app-state";
import { useCategories, useGoals, useInvestments, useTransactions } from "@/lib/data";
import {
  balanceEvolution,
  byCategory,
  categoryBudgets,
  monthlySeries,
  totals,
} from "@/lib/analytics";
import { brl, brlCompact, formatDateBR, monthLabel } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard financeiro — Aura Finanças" },
      {
        name: "description",
        content:
          "Acompanhe saldo, receitas, despesas por categoria e tetos de orçamento com gráficos por data de transação ou vencimento.",
      },
      { property: "og:title", content: "Dashboard financeiro — Aura Finanças" },
      {
        property: "og:description",
        content: "Saldo, receitas, despesas e orçamento por categoria em gráficos intuitivos.",
      },
    ],
  }),
  component: Dashboard,
});

function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-6 ${className}`}>
      <h4 className="text-lg font-bold">{title}</h4>
      {subtitle && <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>}
      {!subtitle && <div className="mb-6" />}
      {children}
    </div>
  );
}

function Dashboard() {
  const { profileId, from, to, dateBasis } = useAppState();
  const [dialog, setDialog] = useState<null | "income" | "expense">(null);

  const { data: txs = [] } = useTransactions({ profileId, from, to, basis: dateBasis });
  const { data: yearTxs = [] } = useTransactions({
    profileId,
    from: `${new Date().getFullYear()}-01-01`,
    to: `${new Date().getFullYear()}-12-31`,
    basis: dateBasis,
  });
  const { data: categories = [] } = useCategories(profileId);
  const { data: investments = [] } = useInvestments(profileId);
  const { data: goals = [] } = useGoals(profileId);

  const t = useMemo(() => totals(txs), [txs]);
  const expenseCats = useMemo(() => byCategory(txs, categories, "expense"), [txs, categories]);
  const incomeCats = useMemo(() => byCategory(txs, categories, "income"), [txs, categories]);
  const months = useMemo(() => monthlySeries(yearTxs, dateBasis), [yearTxs, dateBasis]);
  const evolution = useMemo(() => balanceEvolution(yearTxs, dateBasis), [yearTxs, dateBasis]);
  const budgets = useMemo(
    () => categoryBudgets(txs, categories, from, to),
    [txs, categories, from, to],
  );
  const invested = investments.reduce((s, i) => s + i.current_amount, 0);
  const recent = txs.slice(0, 6);

  return (
    <AppShell
      actions={
        <>
          <Button size="sm" onClick={() => setDialog("income")}>
            + Nova receita
          </Button>
          <Button size="sm" variant="ink" onClick={() => setDialog("expense")}>
            + Nova despesa
          </Button>
        </>
      }
    >
      <h1 className="sr-only">Dashboard financeiro</h1>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="label-caps mb-1">Saldo do período</p>
          <h3 className="text-2xl font-bold tracking-tight">{brl(t.balance)}</h3>
          <p className="mt-4 text-[10px] text-muted-foreground">
            {txs.length} lançamentos no intervalo
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="label-caps mb-1">Receitas</p>
          <h3 className="text-2xl font-bold tracking-tight text-positive">{brl(t.income)}</h3>
          <p className="mt-4 text-[10px] text-muted-foreground">
            {incomeCats.length} categorias de entrada
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="label-caps mb-1">Despesas</p>
          <h3 className="text-2xl font-bold tracking-tight text-negative">{brl(t.expense)}</h3>
          <p className="mt-4 text-[10px] text-muted-foreground">
            {expenseCats.length} categorias de saída
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="label-caps mb-1">Investido</p>
          <h3 className="text-2xl font-bold tracking-tight text-primary">{brl(invested)}</h3>
          <p className="mt-4 text-[10px] text-muted-foreground">
            {investments.length} posições acompanhadas
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="Evolução mensal"
          subtitle="Comparativo entre receitas e despesas no ano"
          className="lg:col-span-2"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                />
                <YAxis tickFormatter={brlCompact} tickLine={false} axisLine={false} fontSize={10} />
                <Tooltip
                  formatter={(v: number) => brl(v)}
                  labelFormatter={monthLabel}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="receitas" fill="var(--color-positive)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="despesas" fill="var(--color-negative)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Teto por categoria" subtitle="Orçamento proporcional aos dias selecionados">
          <div className="space-y-6">
            {budgets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Defina tetos em Categorias para acompanhar o orçamento.
              </p>
            )}
            {budgets.map((b) => (
              <div key={b.category.id}>
                <div className="mb-2 flex justify-between text-xs font-medium">
                  <span>
                    {b.category.emoji} {b.category.name}
                  </span>
                  <span className={b.remaining < 0 ? "text-negative" : "text-muted-foreground"}>
                    {brl(b.spent)} / {brl(b.cap)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${b.remaining < 0 ? "bg-negative" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, b.pct)}%` }}
                  />
                </div>
                <p
                  className={`mt-2 text-[10px] ${b.remaining < 0 ? "text-negative" : "text-muted-foreground"}`}
                >
                  {b.remaining < 0 ? (
                    <>
                      Excedido em <span className="font-bold">{brl(-b.remaining)}</span>
                    </>
                  ) : (
                    <>
                      Disp. diário: <span className="font-bold">{brl(b.remaining / b.days)}</span> ·
                      teto/dia {brl(b.perDay)}
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Despesas por categoria">
          <CategoryPie data={expenseCats} />
        </Panel>
        <Panel title="Entradas por categoria">
          <CategoryPie data={incomeCats} />
        </Panel>
        <Panel title="Evolução do saldo" subtitle="Saldo acumulado no ano">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolution}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis
                  dataKey="month"
                  tickFormatter={monthLabel}
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                />
                <YAxis tickFormatter={brlCompact} tickLine={false} axisLine={false} fontSize={10} />
                <Tooltip
                  formatter={(v: number) => brl(v)}
                  labelFormatter={monthLabel}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <h4 className="font-bold">Transações recentes</h4>
          <a href="/transacoes" className="text-xs font-semibold text-primary">
            Ver tudo
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-secondary/50 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Categoria</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {recent.map((tx) => {
                const cat = categories.find((c) => c.id === tx.category_id);
                return (
                  <tr key={tx.id} className="transition-colors hover:bg-secondary/40">
                    <td className="px-6 py-4 font-mono text-xs">{formatDateBR(tx[dateBasis])}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-medium">{tx.description}</span>
                        {tx.installment_total && (
                          <span className="text-[10px] text-muted-foreground">
                            Parcela {tx.installment_no}/{tx.installment_total}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs">{cat ? `${cat.emoji} ${cat.name}` : "—"}</td>
                    <td className="px-6 py-4 text-xs">
                      {tx.status === "paid"
                        ? tx.kind === "income"
                          ? "Recebido"
                          : "Pago"
                        : "Agendado"}
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-semibold ${tx.kind === "income" ? "text-positive" : "text-negative"}`}
                    >
                      {tx.kind === "income" ? "+ " : "- "}
                      {brl(tx.amount)}
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-muted-foreground">
                    Nenhum lançamento no período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl bg-ink p-8 text-ink-foreground">
          <div className="mb-6 flex items-start justify-between">
            <h4 className="text-lg font-bold">Metas financeiras</h4>
            <a href="/metas" className="text-[10px] font-bold uppercase tracking-widest opacity-60">
              Ver metas
            </a>
          </div>
          <div className="space-y-6">
            {goals.slice(0, 3).map((g) => {
              const pct = g.target_amount ? (g.current_amount / g.target_amount) * 100 : 0;
              return (
                <div key={g.id}>
                  <div className="mb-2 flex justify-between text-xs">
                    <span className="opacity-80">{g.title}</span>
                    <span className="font-mono">{Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-positive"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <p className="text-xs opacity-70">Nenhuma meta cadastrada ainda.</p>
            )}
          </div>
        </div>

        <Panel title="Investimentos" subtitle="Rendimento estimado x real">
          <div className="space-y-3">
            {investments.slice(0, 5).map((i) => {
              const real = i.current_amount - i.invested_amount;
              return (
                <div key={i.id} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {i.name} · {i.type}
                  </span>
                  <span
                    className={`text-xs font-bold ${real >= 0 ? "text-positive" : "text-negative"}`}
                  >
                    {brl(i.current_amount)} ({real >= 0 ? "+" : ""}
                    {brl(real)})
                  </span>
                </div>
              );
            })}
            {investments.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum investimento cadastrado.</p>
            )}
          </div>
        </Panel>
      </div>

      <TransactionDialog
        open={dialog !== null}
        onOpenChange={(v) => setDialog(v ? dialog : null)}
        kind={dialog ?? "expense"}
      />
    </AppShell>
  );
}

function CategoryPie({
  data,
}: {
  data: Array<{ id: string; name: string; color: string; value: number }>;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  }
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
            {data.map((d) => (
              <Cell key={d.id} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => brl(v)}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
