import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { useCategories, useRemove, useUpsert, type Category } from "@/lib/data";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/categorias")({
  head: () => ({
    meta: [
      { title: "Categorias e tetos de gasto — Aura Finanças" },
      {
        name: "description",
        content:
          "Organize categorias de entrada e saída e defina o teto mensal de gastos de cada uma.",
      },
      { property: "og:title", content: "Categorias e tetos de gasto — Aura Finanças" },
      {
        property: "og:description",
        content: "Categorias de entrada e saída com orçamento mensal por categoria.",
      },
    ],
  }),
  component: CategoriesPage,
});

const empty = {
  id: "",
  name: "",
  kind: "expense" as "income" | "expense",
  color: "#3B82F6",
  emoji: "💸",
  monthly_cap: "",
  description: "",
};

function CategoriesPage() {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const upsert = useUpsert("categories");
  const remove = useRemove("categories");
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);

  function edit(c: Category) {
    setForm({
      id: c.id,
      name: c.name,
      kind: c.kind,
      color: c.color,
      emoji: c.emoji,
      monthly_cap: c.monthly_cap != null ? String(c.monthly_cap) : "",
      description: c.description ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name) {
      toast.error("Informe o nome");
      return;
    }
    await upsert.mutateAsync({
      ...(form.id ? { id: form.id } : {}),
      profile_id: profileId,
      name: form.name,
      kind: form.kind,
      color: form.color,
      emoji: form.emoji,
      monthly_cap:
        form.kind === "expense" && form.monthly_cap
          ? Number(form.monthly_cap.replace(",", "."))
          : null,
      description: form.description.trim() || null,
    });
    toast.success("Categoria salva");
    setOpen(false);
    setForm(empty);
  }

  const groups = [
    { kind: "expense" as const, title: "Categorias de saída" },
    { kind: "income" as const, title: "Categorias de entrada" },
  ];

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
          + Nova categoria
        </Button>
      }
    >
      <h1 className="text-2xl font-bold tracking-tight">Centro de categorias</h1>

      {groups.map((g) => (
        <div key={g.kind} className="rounded-2xl border border-border bg-card p-6">
          <h2 className="mb-4 font-bold">{g.title}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {categories
              .filter((c) => c.kind === g.kind)
              .map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-border p-4"
                >
                  <button onClick={() => edit(c)} className="flex items-center gap-3 text-left">
                    <span
                      className="flex size-9 items-center justify-center rounded-lg text-sm"
                      style={{ backgroundColor: `${c.color}20` }}
                    >
                      {c.emoji}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {c.monthly_cap ? `Teto ${brl(Number(c.monthly_cap))}/mês` : "Sem teto"}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => remove.mutate(c.id)}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    aria-label={`Excluir ${c.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            {categories.filter((c) => c.kind === g.kind).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
            )}
          </div>
        </div>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar categoria" : "Nova categoria"}</DialogTitle>
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
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as "income" | "expense" })}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="expense">Saída</option>
                <option value="income">Entrada</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Emoji</Label>
              <Input
                value={form.emoji}
                maxLength={2}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cor</Label>
              <Input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 p-1"
              />
            </div>
            {form.kind === "expense" && (
              <div className="space-y-1.5">
                <Label>Teto mensal (R$)</Label>
                <Input
                  inputMode="decimal"
                  value={form.monthly_cap}
                  onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Palavras-chave da fatura</Label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex.: IFOOD, RESTAURANTE, PADARIA, MERCADO"
                className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Como esses lançamentos aparecem na fatura. A importação por IA usa esses termos para
                classificar as linhas nesta categoria.
              </p>
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
