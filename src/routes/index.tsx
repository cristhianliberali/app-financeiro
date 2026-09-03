import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileScan,
  PiggyBank,
  Plus,
  Repeat,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { TransactionDialog } from "@/components/TransactionDialog";
import { RecurringDialog } from "@/components/RecurringDialog";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/app-state";
import { useCategories, useGoals, useInvestments, useTransactions } from "@/lib/data";
import {
  balanceEvolution,
  byCategory,
  categoryBudgets,
  monthlySeries,
  settlement,
} from "@/lib/analytics";
import { MonthTimeline } from "@/components/MonthTimeline";
import { CategoryPie } from "@/components/CategoryPie";
import { brl, brlCompact, formatDateBR, monthLabel } from "@/lib/format";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";
import { StatusPill } from "@/components/ui/status";

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

/** Estilo compartilhado dos balões dos gráficos. */
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  background: "var(--color-popover)",
  boxShadow: "var(--elevation-lg)",
  fontSize: 12,
} as const;

/**
 * Cartão de um lado do caixa, com a quebra por situação.
 *
 * O total sozinho esconde a pergunta que importa no fim do mês: quanto disso já
 * aconteceu e quanto ainda vai acontecer. As duas linhas de baixo respondem
 * isso sem exigir um clique.
 */
function SettlementCard({
  label,
  total,
  icon: Icon,
  tone,
  rows,
}: {
  label: string;
  total: string;
  icon: typeof Wallet;
  tone: "positive" | "negative";
  rows: Array<{ label: string; value: string; state: "done" | "pending" }>;
}) {
  const accent = tone === "positive" ? "text-positive" : "text-negative";
  const chip =
    tone === "positive"
      ? "bg-positive-soft text-positive-soft-foreground"
      : "bg-negative-soft text-negative-soft-foreground";

  return (
    <div
      className={`panel state-bar overflow-hidden ${tone === "positive" ? "state-done" : "state-late"}`}
    >
      {/* Rótulo em cima, número embaixo: lado a lado, o nome longo espremia o
          valor, que é justamente o que se quer ler primeiro. */}
      <div className="p-5 pb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-bold tracking-tight">{label}</p>
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${chip}`}>
            <Icon className="size-4" strokeWidth={2.25} />
          </span>
        </div>
        <p className={`stat-figure ${accent}`}>{total}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">No período selecionado</p>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-5 py-2.5">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {row.state === "done" ? (
                <CheckCircle2 className="size-3.5 text-positive" />
              ) : (
                <Clock3 className="size-3.5 text-info" />
              )}
              {row.label}
            </span>
            <span className="font-mono text-xs font-bold" data-numeric>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <div className={`panel flex flex-col p-6 ${className}`}>
      <h4 className="text-base font-bold tracking-tight">{title}</h4>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      {/* `flex-1` faz o gráfico crescer até a altura do cartão vizinho, em vez
          de deixar um vão embaixo quando a coluna ao lado é mais alta. */}
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

function Dashboard() {
  const { profileId, from, to, dateBasis } = useAppState();
  const [dialog, setDialog] = useState<null | "income" | "expense">(null);
  const [recurringOpen, setRecurringOpen] = useState(false);

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

  const cash = useMemo(() => settlement(txs), [txs]);
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
        /*
          As mesmas ações do centro de transações, aqui em cima: o dashboard é
          onde o dia começa, e mandar alguém trocar de tela só para abrir as
          recorrências ou importar uma fatura é um desvio sem motivo.
        */
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRecurringOpen(true)}>
            <Repeat /> Recorrentes
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/importar">
              <FileScan /> Importar com IA
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("income")}>
            <Plus /> Receita
          </Button>
          <Button size="sm" variant="brand" onClick={() => setDialog("expense")}>
            <Plus /> Despesa
          </Button>
        </div>
      }
    >
      <h1 className="sr-only">Dashboard financeiro</h1>

      <MonthTimeline />

      <div className="grid gap-4 lg:grid-cols-3">
        <SettlementCard
          label="Receitas"
          total={brl(cash.income)}
          icon={ArrowUpRight}
          tone="positive"
          rows={[
            { label: "Recebido", value: brl(cash.received), state: "done" },
            { label: "A receber", value: brl(cash.toReceive), state: "pending" },
          ]}
        />
        <SettlementCard
          label="Despesas"
          total={brl(cash.expense)}
          icon={ArrowDownRight}
          tone="negative"
          rows={[
            { label: "Pago", value: brl(cash.paid), state: "done" },
            { label: "Não pago", value: brl(cash.toPay), state: "pending" },
          ]}
        />
        {/*
          Os dois saldos lado a lado: o que está em caixa agora e onde o período
          termina se tudo o que está agendado acontecer.
        */}
        <div className="panel divide-y divide-border">
          {(
            [
              {
                label: "Saldo disponível",
                hint: "Só o que já foi liquidado",
                value: cash.available,
                icon: Wallet,
                chip: "bg-positive-soft text-positive-soft-foreground",
                accent: cash.available < 0 ? "text-negative" : "text-positive",
              },
              {
                label: "Saldo previsto",
                hint: "Com o que ainda está agendado",
                value: cash.projected,
                icon: CircleDollarSign,
                chip: "bg-primary-soft text-primary",
                accent: cash.projected < 0 ? "text-negative" : "text-primary",
              },
            ] as const
          ).map((row) => (
            <div key={row.label} className="flex flex-1 flex-col justify-center p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-bold tracking-tight">{row.label}</p>
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${row.chip}`}
                >
                  <row.icon className="size-4" strokeWidth={2.25} />
                </span>
              </div>
              <p className={`stat-figure ${row.accent}`}>{brl(row.value)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{row.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Evolução mensal"
          subtitle="Comparativo entre receitas e despesas no ano"
          className="lg:col-span-2"
        >
          <div className="h-full min-h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} barCategoryGap="28%" maxBarSize={56}>
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
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="receitas" fill="var(--color-positive)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="despesas" fill="var(--color-negative)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Teto por categoria" subtitle="Orçamento proporcional aos dias selecionados">
          {/*
            Teto de altura só no desktop.
            Cada categoria com teto acrescenta uns 88px à lista, e como o cartão
            vizinho usa `h-full` para acompanhar o mais alto da fileira, uma
            conta com quinze categorias esticava a fileira inteira: o gráfico de
            evolução virava uma faixa de dois metros ao lado de uma lista sem
            fim. Com o teto, a fileira volta a ter tamanho de fileira e a lista
            rola por dentro.

            No celular não: ali os cartões são um embaixo do outro, nada estica
            nada, e uma caixa que rola dentro de uma página que rola é o pior
            gesto que existe num telefone.
          */}
          <div className="space-y-6 lg:max-h-[26rem] lg:overflow-y-auto lg:overflow-x-hidden lg:pr-2">
            {budgets.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Defina tetos em Categorias para acompanhar o orçamento.
              </p>
            )}
            {budgets.map((b) => (
              <div key={b.category.id}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold">
                  <span className="flex min-w-0 items-center gap-2">
                    <IconBadge
                      name={b.category.emoji}
                      color={b.category.color}
                      size="sm"
                      fallback={DEFAULT_CATEGORY_ICON}
                    />
                    <span className="truncate">{b.category.name}</span>
                  </span>
                  <span
                    className={b.remaining < 0 ? "text-negative" : "text-muted-foreground"}
                    data-numeric
                  >
                    {brl(b.spent)} / {brl(b.cap)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      b.remaining < 0 ? "bg-negative" : b.pct > 80 ? "bg-warning" : "brand-gradient"
                    }`}
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

      <div className="grid gap-4 lg:grid-cols-3">
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
                  contentStyle={TOOLTIP_STYLE}
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

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-6">
          <h4 className="text-base font-bold tracking-tight">Transações recentes</h4>
          <a
            href="/transacoes"
            className="text-xs font-bold text-primary transition-opacity hover:opacity-70"
          >
            Ver tudo →
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="label-caps px-6 py-3.5 text-left">Data</th>
                <th className="label-caps px-6 py-3.5 text-left">Descrição</th>
                <th className="label-caps px-6 py-3.5 text-left">Categoria</th>
                <th className="label-caps px-6 py-3.5 text-left">Status</th>
                <th className="label-caps px-6 py-3.5 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {recent.map((tx) => {
                const cat = categories.find((c) => c.id === tx.category_id);
                return (
                  <tr key={tx.id} className="transition-colors hover:bg-accent/40">
                    {/* A borda esquerda repete o estado da linha: quem varre a
                        coluna de datas já vê o que está pago e o que falta. */}
                    <td
                      className={`border-l-[3px] px-6 py-3.5 font-mono text-xs ${
                        tx.status === "paid" ? "border-l-positive" : "border-l-info"
                      }`}
                    >
                      {formatDateBR(tx[dateBasis])}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold">{tx.description}</span>
                        {tx.installment_total && (
                          <span className="text-[10px] text-muted-foreground">
                            Parcela {tx.installment_no}/{tx.installment_total}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-xs">
                      {cat ? (
                        <span className="flex items-center gap-2">
                          <IconBadge
                            name={cat.emoji}
                            color={cat.color}
                            size="sm"
                            fallback={DEFAULT_CATEGORY_ICON}
                          />
                          <span className="truncate font-medium">{cat.name}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {tx.status === "paid" ? (
                        <StatusPill tone="done" icon={CheckCircle2}>
                          {tx.kind === "income" ? "Recebido" : "Pago"}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="pending" icon={Clock3}>
                          Agendado
                        </StatusPill>
                      )}
                    </td>
                    <td
                      className={`px-6 py-3.5 text-right font-bold ${tx.kind === "income" ? "text-positive" : "text-negative"}`}
                      data-numeric
                    >
                      {tx.kind === "income" ? "+ " : "− "}
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="brand-gradient relative overflow-hidden rounded-2xl p-7 shadow-lg">
          {/* Brilho de canto: dá volume ao cartão sem competir com os números. */}
          <span className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-white/10 blur-2xl" />
          <div className="relative mb-6 flex items-start justify-between">
            <h4 className="flex items-center gap-2 text-lg font-bold">
              <PiggyBank className="size-5" /> Metas financeiras
            </h4>
            <a
              href="/metas"
              className="text-[10px] font-bold uppercase tracking-widest opacity-70 transition-opacity hover:opacity-100"
            >
              Ver metas
            </a>
          </div>
          <div className="relative space-y-5">
            {goals.slice(0, 3).map((g) => {
              const pct = g.target_amount ? (g.current_amount / g.target_amount) * 100 : 0;
              return (
                <div key={g.id}>
                  <div className="mb-2 flex justify-between text-xs font-medium">
                    <span className="opacity-85">{g.title}</span>
                    <span className="font-mono font-bold">{Math.round(pct)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-500"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <p className="text-xs opacity-80">Nenhuma meta cadastrada ainda.</p>
            )}
          </div>
        </div>

        <Panel
          title="Investimentos"
          subtitle={`${brl(invested)} em ${investments.length} ${
            investments.length === 1 ? "posição acompanhada" : "posições acompanhadas"
          }`}
        >
          <div className="space-y-3">
            {investments.slice(0, 5).map((i) => {
              const real = i.current_amount - i.invested_amount;
              return (
                <div
                  key={i.id}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {i.name} · {i.type}
                  </span>
                  <span
                    className={`text-xs font-bold ${real >= 0 ? "text-positive" : "text-negative"}`}
                    data-numeric
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
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} />
    </AppShell>
  );
}
