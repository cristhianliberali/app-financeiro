import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Target, Trash2 } from "lucide-react";
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
import { useGoals, useRemove, useUpsert, type Goal } from "@/lib/data";
import { brl, formatDateBR } from "@/lib/format";

export const Route = createFileRoute("/metas")({
  head: () => ({
    meta: [
      { title: "Objetivos e metas — Aura Finanças" },
      {
        name: "description",
        content:
          "Defina metas pessoais, financeiras, de economia e de investimento e acompanhe o progresso.",
      },
      { property: "og:title", content: "Objetivos e metas — Aura Finanças" },
      {
        property: "og:description",
        content: "Metas pessoais e financeiras com progresso acompanhado em tempo real.",
      },
    ],
  }),
  component: GoalsPage,
});

const kinds = [
  { value: "personal", label: "Pessoal" },
  { value: "financial", label: "Financeira" },
  { value: "saving", label: "Economia" },
  { value: "investment", label: "Investimento" },
] as const;

const empty = {
  id: "",
  title: "",
  kind: "financial" as Goal["kind"],
  target_amount: "",
  current_amount: "",
  target_date: "",
};

function GoalsPage() {
  const { profileId } = useAppState();
  const { data: goals = [] } = useGoals(profileId);
  const upsert = useUpsert("goals");
  const remove = useRemove("goals");
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);

  async function save() {
    if (!form.title) {
      toast.error("Informe o título da meta");
      return;
    }
    await upsert.mutateAsync({
      ...(form.id ? { id: form.id } : {}),
      profile_id: profileId,
      title: form.title,
      kind: form.kind,
      target_amount: Number(form.target_amount.replace(",", ".")) || 0,
      current_amount: Number(form.current_amount.replace(",", ".")) || 0,
      target_date: form.target_date || null,
    });
    toast.success("Meta salva");
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
          <Plus /> Nova meta
        </Button>
      }
    >
      <h1 className="title-xl">Objetivos e metas</h1>

      {kinds.map((k) => {
        const list = goals.filter((g) => g.kind === k.value);
        if (list.length === 0) return null;
        return (
          <div key={k.value} className="panel p-6">
            <h2 className="mb-4 text-base font-bold tracking-tight">
              Metas de {k.label.toLowerCase()}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {list.map((g) => {
                const pct = g.target_amount ? (g.current_amount / g.target_amount) * 100 : 0;
                return (
                  <div
                    key={g.id}
                    className={`panel-interactive state-bar p-4 ${
                      g.done || pct >= 100 ? "state-done" : "state-pending"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <button
                        className="text-left"
                        onClick={() => {
                          setForm({
                            id: g.id,
                            title: g.title,
                            kind: g.kind,
                            target_amount: String(g.target_amount),
                            current_amount: String(g.current_amount),
                            target_date: g.target_date ?? "",
                          });
                          setOpen(true);
                        }}
                      >
                        <p className={`text-sm font-bold ${g.done ? "done-text" : ""}`}>
                          {g.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.target_date ? `Prazo ${formatDateBR(g.target_date)}` : "Sem prazo"}
                        </p>
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => upsert.mutate({ id: g.id, done: !g.done })}
                          className={`rounded-lg p-1.5 transition-colors ${
                            g.done
                              ? "bg-positive-soft text-positive-soft-foreground"
                              : "text-muted-foreground hover:bg-positive-soft hover:text-positive-soft-foreground"
                          }`}
                          aria-label={g.done ? "Reabrir meta" : "Concluir meta"}
                          title={g.done ? "Reabrir meta" : "Concluir meta"}
                        >
                          <Check className="size-4" strokeWidth={3} />
                        </button>
                        <button
                          onClick={() => remove.mutate(g.id)}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative-soft hover:text-destructive"
                          aria-label="Excluir meta"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${
                          g.done || pct >= 100 ? "bg-positive" : "brand-gradient"
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <p className="mt-2 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                      <span>
                        {brl(g.current_amount)} / {brl(g.target_amount)}
                      </span>
                      <span
                        className={`font-bold ${g.done || pct >= 100 ? "text-positive" : "text-foreground"}`}
                      >
                        {Math.round(pct)}%
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {goals.length === 0 && (
        <div className="panel brand-sheen flex flex-col items-center gap-3 p-12 text-center">
          <span className="brand-gradient flex size-12 items-center justify-center rounded-2xl shadow-glow">
            <Target className="size-5" />
          </span>
          <p className="text-sm font-semibold">Nenhuma meta cadastrada</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Crie metas pessoais, financeiras, de economia ou investimento e acompanhe o avanço de
            cada uma por aqui.
          </p>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar meta" : "Nova meta"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Título</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as Goal["kind"] })}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
              >
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Prazo</Label>
              <DateField
                type="date"
                value={form.target_date}
                onChange={(e) => setForm({ ...form, target_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valor alvo (R$)</Label>
              <Input
                inputMode="decimal"
                value={form.target_amount}
                onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
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
