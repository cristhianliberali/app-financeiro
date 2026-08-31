import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  Pencil,
  Search,
  X,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { TransactionDialog } from "@/components/TransactionDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status";
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
import { useCategories, useTransactions, useUpsert, type Transaction } from "@/lib/data";
import { PENDING_LABEL, pendingState, type PendingState } from "@/lib/analytics";
import { brl, formatDateBR, toISODate } from "@/lib/format";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";

export const Route = createFileRoute("/pendentes")({
  head: () => ({
    meta: [
      { title: "Transações pendentes — Aura Finanças" },
      {
        name: "description",
        content:
          "Tudo o que ainda não foi pago ou recebido, separado por entradas e saídas, com baixa em massa.",
      },
    ],
  }),
  component: PendingPage,
});

const SELECT_CLASS =
  "h-11 rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

/** Recortes de vencimento oferecidos no filtro. */
const DUE_FILTERS = [
  { value: "all", label: "Todos os vencimentos" },
  { value: "overdue", label: "Só as atrasadas" },
  { value: "today", label: "Vencem hoje" },
  { value: "week", label: "Próximos 7 dias" },
  { value: "month", label: "Até o fim do mês" },
] as const;

type DueFilter = (typeof DUE_FILTERS)[number]["value"];

const TONE: Record<PendingState, "late" | "due" | "pending"> = {
  overdue: "late",
  today: "due",
  upcoming: "pending",
};

/**
 * Transações pendentes.
 *
 * As outras telas de Finanças mostram um recorte de tempo; esta mostra uma
 * dívida. Um boleto que venceu em março continua sendo um problema em agosto,
 * então aqui o período global não se aplica — a lista traz tudo o que ainda não
 * foi liquidado, do mais atrasado ao mais distante, e é o filtro de vencimento
 * que estreita quando se quer olhar só um pedaço.
 *
 * Dar baixa é a ação da tela, e ela é destrutiva na medida em que muda dinheiro
 * já conferido. Por isso: uma linha sozinha vai direto, várias de uma vez pedem
 * confirmação, e toda baixa deixa um "desfazer" no canto por alguns segundos.
 */
function PendingPage() {
  const { profileId } = useAppState();
  // Sem `from`/`to`: pendência não tem mês, tem vencimento.
  const { data: all = [] } = useTransactions({ profileId });
  const { data: categories = [] } = useCategories(profileId);
  const upsert = useUpsert("transactions");

  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [due, setDue] = useState<DueFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Transaction[] | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const today = toISODate(new Date());
  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  const pending = useMemo(() => {
    const limit = (() => {
      if (due === "week") {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return toISODate(d);
      }
      if (due === "month") {
        const d = new Date();
        return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      }
      return null;
    })();

    const needle = term.trim().toLowerCase();

    return (
      all
        .filter((t) => t.status === "pending")
        .filter((t) => !categoryId || t.category_id === categoryId)
        .filter((t) => !needle || t.description.toLowerCase().includes(needle))
        .filter((t) => {
          if (due === "overdue") return t.due_date < today;
          if (due === "today") return t.due_date === today;
          return !limit || t.due_date <= limit;
        })
        // O mais urgente primeiro: é a ordem em que se resolve a lista.
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
    );
  }, [all, categoryId, term, due, today]);

  const income = pending.filter((t) => t.kind === "income");
  const expense = pending.filter((t) => t.kind === "expense");

  /** A seleção só conta o que está na tela: filtrar não pode dar baixa às cegas. */
  const chosen = useMemo(() => pending.filter((t) => selected.has(t.id)), [pending, selected]);

  const overdue = pending.filter((t) => t.due_date < today);
  const sum = (list: Transaction[]) => list.reduce((s, t) => s + t.amount, 0);

  function toggle(id: string) {
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
   * Dá baixa e oferece o caminho de volta.
   *
   * O aviso fica no canto inferior direito — longe do topo, onde o resto do app
   * avisa coisas — porque ele não é uma notificação: é a última chance de voltar
   * atrás, e precisa durar mais e não competir com o que vem depois.
   */
  async function settle(list: Transaction[]) {
    if (list.length === 0) return;
    const ids = list.map((t) => t.id);

    await upsert.mutateAsync(ids.map((id) => ({ id, status: "paid" })));
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });

    const onlyIncome = list.every((t) => t.kind === "income");
    const onlyExpense = list.every((t) => t.kind === "expense");
    const what =
      list.length === 1
        ? onlyIncome
          ? "Recebimento registrado"
          : "Pagamento registrado"
        : onlyIncome
          ? `${list.length} recebimentos registrados`
          : onlyExpense
            ? `${list.length} pagamentos registrados`
            : `${list.length} lançamentos baixados`;

    toast.success(what, {
      description: `${brl(sum(list))} · ${list.length === 1 ? list[0]!.description : "saiu da lista de pendentes"}`,
      position: "bottom-right",
      duration: 8000,
      action: {
        label: "Desfazer",
        onClick: () => {
          void upsert
            .mutateAsync(ids.map((id) => ({ id, status: "pending" })))
            .then(() => toast.info("Baixa desfeita", { position: "bottom-right" }));
        },
      },
    });
  }

  /** Uma só vai direto; mais de uma passa pela confirmação. */
  function requestSettle(list: Transaction[]) {
    if (list.length > 1) setConfirming(list);
    else void settle(list);
  }

  const section = (title: string, list: Transaction[], kind: "income" | "expense") => {
    const allChecked = list.length > 0 && list.every((t) => selected.has(t.id));
    const someChecked = list.some((t) => selected.has(t.id));

    return (
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={(checked) => toggleMany(list, checked === true)}
            disabled={list.length === 0}
            aria-label={`Selecionar todas as ${title.toLowerCase()}`}
          />
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
              kind === "income"
                ? "bg-positive-soft text-positive-soft-foreground"
                : "bg-negative-soft text-negative-soft-foreground"
            }`}
          >
            {kind === "income" ? (
              <ArrowUpRight className="size-4" strokeWidth={2.25} />
            ) : (
              <ArrowDownLeft className="size-4" strokeWidth={2.25} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight">{title}</h2>
            <p className="text-[11px] text-muted-foreground">
              {list.length} {list.length === 1 ? "lançamento" : "lançamentos"}
            </p>
          </div>
          <p
            className={`stat-figure ${kind === "income" ? "text-positive" : "text-negative"}`}
            data-numeric
          >
            {brl(sum(list))}
          </p>
        </div>

        {list.length === 0 ? (
          <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <CheckCheck className="size-4 text-positive" />
            Nada pendente por aqui.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {list.map((t) => {
              const state = pendingState(t.due_date, today);
              const cat = t.category_id ? catMap[t.category_id] : undefined;
              const checked = selected.has(t.id);
              return (
                <div
                  key={t.id}
                  className={`state-bar flex items-center gap-3 px-4 py-3 transition-colors ${
                    checked ? "bg-primary-soft/40" : "hover:bg-accent/40"
                  } ${state === "overdue" ? "state-late" : state === "today" ? "state-due" : "state-pending"}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(t.id)}
                    aria-label={`Selecionar ${t.description}`}
                  />
                  <IconBadge
                    name={cat?.emoji}
                    color={cat?.color}
                    fallback={kind === "income" ? "banknote" : DEFAULT_CATEGORY_ICON}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {t.description}
                      {t.installment_total &&
                      !t.description
                        .trim()
                        .endsWith(`${t.installment_no}/${t.installment_total}`) ? (
                        <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                          {t.installment_no}/{t.installment_total}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {cat?.name ?? "Sem categoria"} · vence {formatDateBR(t.due_date)}
                    </p>
                  </div>

                  <span className="hidden sm:block">
                    <StatusPill tone={TONE[state]}>{PENDING_LABEL[state]}</StatusPill>
                  </span>

                  <span
                    className={`font-mono text-sm font-bold ${
                      kind === "income" ? "text-positive" : "text-negative"
                    }`}
                    data-numeric
                  >
                    {brl(t.amount)}
                  </span>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setEditing(t)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
                      aria-label={`Editar ${t.description}`}
                      title="Editar lançamento"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => requestSettle([t])}
                      disabled={upsert.isPending}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-positive-soft hover:text-positive-soft-foreground disabled:opacity-50"
                      aria-label={`Marcar ${t.description} como ${kind === "income" ? "recebida" : "paga"}`}
                      title={kind === "income" ? "Marcar como recebida" : "Marcar como paga"}
                    >
                      <Check className="size-4" strokeWidth={3} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <AppShell showPeriodBar={false}>
      <div>
        <h1 className="title-xl">Transações pendentes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tudo o que ainda não foi pago ou recebido, do vencimento mais antigo ao mais distante.
          Esta tela ignora o período das outras — uma conta atrasada não deixa de existir quando o
          mês vira.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel state-bar state-done p-5">
          <p className="label-caps">A receber</p>
          <p className="stat-figure mt-2 text-positive">{brl(sum(income))}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {income.length} {income.length === 1 ? "entrada" : "entradas"}
          </p>
        </div>
        <div className="panel state-bar state-late p-5">
          <p className="label-caps">A pagar</p>
          <p className="stat-figure mt-2 text-negative">{brl(sum(expense))}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {expense.length} {expense.length === 1 ? "saída" : "saídas"}
          </p>
        </div>
        <button
          onClick={() => setDue(due === "overdue" ? "all" : "overdue")}
          aria-pressed={due === "overdue"}
          className={`panel state-bar state-due p-5 text-left transition-colors ${
            due === "overdue" ? "ring-2 ring-ring/40" : "hover:bg-accent/40"
          }`}
        >
          <p className="label-caps flex items-center gap-1.5">
            {overdue.length > 0 && <AlertTriangle className="size-3.5 text-negative pulse-alert" />}
            Vencidas
          </p>
          <p className={`stat-figure mt-2 ${overdue.length ? "text-negative" : ""}`}>
            {brl(sum(overdue))}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {overdue.length} {overdue.length === 1 ? "em atraso" : "em atraso"} ·{" "}
            {due === "overdue" ? "mostrando só elas" : "clique para filtrar"}
          </p>
        </button>
      </div>

      <div className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar por descrição…"
            className="pl-9"
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${SELECT_CLASS} md:w-56`}
          aria-label="Filtrar por categoria"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={due}
          onChange={(e) => setDue(e.target.value as DueFilter)}
          className={`${SELECT_CLASS} md:w-52`}
          aria-label="Filtrar por vencimento"
        >
          {DUE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/*
        Barra de ação da seleção. Fica grudada no topo enquanto se rola a lista:
        selecionar dez linhas e ter de voltar ao começo para agir seria o mesmo
        que não ter seleção em massa.
      */}
      {chosen.length > 0 && (
        <div className="sticky top-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary-soft p-3 shadow-lg backdrop-blur-xl">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CheckCheck className="size-4" strokeWidth={2.5} />
          </span>
          <p className="text-sm font-semibold text-primary-soft-foreground">
            {chosen.length} {chosen.length === 1 ? "selecionada" : "selecionadas"} ·{" "}
            <span className="font-mono" data-numeric>
              {brl(sum(chosen))}
            </span>
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X /> Limpar seleção
            </Button>
            <Button
              size="sm"
              variant="brand"
              disabled={upsert.isPending}
              onClick={() => requestSettle(chosen)}
            >
              <Check strokeWidth={3} />
              {chosen.every((t) => t.kind === "income")
                ? "Marcar como recebidas"
                : chosen.every((t) => t.kind === "expense")
                  ? "Marcar como pagas"
                  : "Dar baixa nas selecionadas"}
            </Button>
          </div>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="panel brand-sheen flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-positive-soft text-positive-soft-foreground">
            <CheckCheck className="size-5" />
          </span>
          <p className="text-sm font-semibold">
            {all.some((t) => t.status === "pending")
              ? "Nada pendente com estes filtros"
              : "Nenhuma pendência"}
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {all.some((t) => t.status === "pending")
              ? "Afrouxe a busca ou o filtro de vencimento para ver o resto."
              : "Tudo o que foi lançado já está pago ou recebido."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {section("Entradas a receber", income, "income")}
          {section("Saídas a pagar", expense, "expense")}
        </div>
      )}

      {/* Confirmação da baixa em massa: quantas, quanto, e o que some da tela. */}
      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dar baixa em {confirming?.length ?? 0} lançamentos?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Eles passam a contar como liquidados e saem desta tela. O total afetado é{" "}
                  <span className="font-semibold text-foreground">
                    {brl(sum(confirming ?? []))}
                  </span>
                  .
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-3 text-xs">
                  {(confirming ?? []).map((t) => (
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
                <p>Dá para desfazer logo depois, pelo aviso no canto da tela.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const list = confirming ?? [];
                setConfirming(null);
                void settle(list);
              }}
            >
              Confirmar baixa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        <TransactionDialog
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          kind={editing.kind}
          editing={editing}
        />
      )}
    </AppShell>
  );
}
