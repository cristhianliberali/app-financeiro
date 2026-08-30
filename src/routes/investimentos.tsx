import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
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
import { useGoals, useInvestments, useRemove, useUpsert, type Investment } from "@/lib/data";
import { brl, brlCompact, toISODate } from "@/lib/format";

export const Route = createFileRoute("/investimentos")({
  head: () => ({
    meta: [
      { title: "Investimentos e planejamento — Aura Finanças" },
      {
        name: "description",
        content:
          "Acompanhe investimentos com rendimento estimado x real e planeje metas de investimento e economia.",
      },
      { property: "og:title", content: "Investimentos e planejamento — Aura Finanças" },
      {
        property: "og:description",
        content: "Rendimento estimado x real, metas de investimento e de economia.",
      },
    ],
  }),
  component: InvestmentsPage,
});

const empty = {
  id: "",
  name: "",
  type: "Renda Fixa",
  invested_amount: "",
  current_amount: "",
  expected_rate: "",
  started_at: toISODate(new Date()),
};

/** Rendimento estimado: valor aplicado corrigido pela taxa a.a. desde o início. */
function estimated(i: Investment) {
  const months =
    (new Date().getFullYear() - new Date(i.started_at).getFullYear()) * 12 +
    (new Date().getMonth() - new Date(i.started_at).getMonth());
  const monthlyRate = i.expected_rate / 100 / 12;
  return i.invested_amount * Math.pow(1 + monthlyRate, Math.max(0, months)) - i.invested_amount;
}

function InvestmentsPage() {
  const { profileId } = useAppState();
  const { data: investments = [] } = useInvestments(profileId);
  const { data: goals = [] } = useGoals(profileId);
  const upsert = useUpsert("investments");
  const remove = useRemove("investments");
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);

  const chart = investments.map((i) => ({
    name: i.name,
    estimado: Number(estimated(i).toFixed(2)),
    real: Number((i.current_amount - i.invested_amount).toFixed(2)),
  }));

  const planGoals = goals.filter((g) => g.kind === "investment" || g.kind === "saving");

  async function save() {
    if (!form.name) {
      toast.error("Informe o nome do investimento");
      return;
    }
    await upsert.mutateAsync({
      ...(form.id ? { id: form.id } : {}),
      profile_id: profileId,
      name: form.name,
      type: form.type,
      invested_amount: Number(form.invested_amount.replace(",", ".")) || 0,
      current_amount: Number(form.current_amount.replace(",", ".")) || 0,
      expected_rate: Number(form.expected_rate.replace(",", ".")) || 0,
      started_at: form.started_at,
    });
    toast.success("Investimento salvo");
    setOpen(false);
    setForm(empty);
  }

  return (
    <AppShell
      actions={
        <Button
          size="sm"
          onClick={() => {
            setForm(empty);
            setOpen(true);
          }}
        >
          + Novo investimento
        </Button>
      }
    >
      <h1 className="text-2xl font-bold tracking-tight">Investimentos e planejamento</h1>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-6 font-bold">Rendimento estimado x real</h2>
        {chart.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Cadastre um investimento para ver o gráfico.
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} />
                <YAxis tickFormatter={brlCompact} tickLine={false} axisLine={false} fontSize={10} />
                <Tooltip
                  formatter={(v: number) => brl(v)}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="estimado" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="real" fill="var(--color-positive)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {investments.map((i) => {
          const real = i.current_amount - i.invested_amount;
          return (
            <div key={i.id} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start justify-between">
                <button
                  className="text-left"
                  onClick={() => {
                    setForm({
                      id: i.id,
                      name: i.name,
                      type: i.type,
                      invested_amount: String(i.invested_amount),
                      current_amount: String(i.current_amount),
                      expected_rate: String(i.expected_rate),
                      started_at: i.started_at,
                    });
                    setOpen(true);
                  }}
                >
                  <p className="label-caps">{i.type}</p>
                  <h3 className="text-lg font-bold">{i.name}</h3>
                </button>
                <button
                  onClick={() => remove.mutate(i.id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={`Excluir ${i.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <p className="mt-4 font-mono text-xl font-bold">{brl(i.current_amount)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aplicado {brl(i.invested_amount)} · estimado {brl(estimated(i))}
              </p>
              <p
                className={`mt-2 text-xs font-semibold ${real >= 0 ? "text-positive" : "text-negative"}`}
              >
                Resultado real {real >= 0 ? "+" : ""}
                {brl(real)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 font-bold">Metas de investimento e economia</h2>
        <div className="space-y-5">
          {planGoals.map((g) => {
            const pct = g.target_amount ? (g.current_amount / g.target_amount) * 100 : 0;
            return (
              <div key={g.id}>
                <div className="mb-2 flex justify-between text-xs">
                  <span className="font-medium">{g.title}</span>
                  <span className="font-mono text-muted-foreground">
                    {brl(g.current_amount)} / {brl(g.target_amount)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
          {planGoals.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Cadastre metas de economia ou investimento na página Metas.
            </p>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar investimento" : "Novo investimento"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Input
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Início</Label>
              <DateField
                type="date"
                value={form.started_at}
                onChange={(e) => setForm({ ...form, started_at: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor aplicado (R$)</Label>
              <Input
                inputMode="decimal"
                value={form.invested_amount}
                onChange={(e) => setForm({ ...form, invested_amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor atual (R$)</Label>
              <Input
                inputMode="decimal"
                value={form.current_amount}
                onChange={(e) => setForm({ ...form, current_amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Rendimento estimado (% a.a.)</Label>
              <Input
                inputMode="decimal"
                value={form.expected_rate}
                onChange={(e) => setForm({ ...form, expected_rate: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
