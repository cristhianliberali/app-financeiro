import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        content: "Defina metas pessoais, financeiras, de economia e de investimento e acompanhe o progresso.",
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
          + Nova meta
        </Button>
      }
    >
      <h1 className="text-2xl font-bold tracking-tight">Objetivos e metas</h1>

      {kinds.map((k) => {
        const list = goals.filter((g) => g.kind === k.value);
        if (list.length === 0) return null;
        return (
          <div key={k.value} className="rounded-2xl border border-border bg-card p-6">
            <h2 className="mb-4 font-bold">Metas de {k.label.toLowerCase()}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {list.map((g) => {
                const pct = g.target_amount ? (g.current_amount / g.target_amount) * 100 : 0;
                return (
                  <div key={g.id} className="rounded-xl border border-border p-4">
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
                        <p className="text-sm font-semibold">{g.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.target_date ? `Prazo ${formatDateBR(g.target_date)}` : "Sem prazo"}
                        </p>
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => upsert.mutate({ id: g.id, done: !g.done })}
                          className={`transition-colors ${g.done ? "text-positive" : "text-muted-foreground hover:text-positive"}`}
                          aria-label="Concluir meta"
                        >
                          <Check className="size-4" />
                        </button>
                        <button
                          onClick={() => remove.mutate(g.id)}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                          aria-label="Excluir meta"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full ${g.done ? "bg-positive" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {brl(g.current_amount)} / {brl(g.target_amount)} · {Math.round(pct)}%
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {goals.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nenhuma meta cadastrada. Crie metas pessoais, financeiras, de economia ou investimento.
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
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
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
              <Input
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
