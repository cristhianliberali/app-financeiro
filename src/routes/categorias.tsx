import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
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
import { useCategories, useUpsert, type Category } from "@/lib/data";
import { brl, formatDateBR } from "@/lib/format";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";
import { IconPicker } from "@/components/IconPicker";

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
  color: "#6366F1",
  /* A coluna se chama `emoji` desde antes do banco de ícones; hoje ela guarda
     o nome do ícone (src/lib/icons.tsx). */
  emoji: DEFAULT_CATEGORY_ICON,
  monthly_cap: "",
  description: "",
};

function CategoriesPage() {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const upsert = useUpsert("categories");
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState<Category | null>(null);
  /** O que está sendo editado é uma categoria arquivada? */
  const editingArchived = categories.some((c) => c.id === form.id && c.archived_at);

  const active = useMemo(() => categories.filter((c) => !c.archived_at), [categories]);
  const archived = useMemo(() => categories.filter((c) => c.archived_at), [categories]);

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
          <Plus /> Nova categoria
        </Button>
      }
    >
      <h1 className="title-xl">Centro de categorias</h1>

      {groups.map((g) => (
        <div key={g.kind} className="panel p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
            <span
              className={`size-2 rounded-full ${g.kind === "income" ? "bg-positive" : "bg-negative"}`}
            />
            {g.title}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active
              .filter((c) => c.kind === g.kind)
              .map((c) => (
                <div key={c.id} className="panel-interactive flex items-center justify-between p-4">
                  <button
                    onClick={() => edit(c)}
                    className="flex min-w-0 items-center gap-3 text-left"
                    aria-label={`Editar ${c.name}`}
                  >
                    <IconBadge name={c.emoji} color={c.color} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {c.monthly_cap ? `Teto ${brl(Number(c.monthly_cap))}/mês` : "Sem teto"}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => edit(c)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
                      aria-label={`Editar ${c.name}`}
                      title="Editar categoria"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => setArchiving(c)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-negative-soft hover:text-destructive"
                      aria-label={`Arquivar ${c.name}`}
                      title="Arquivar categoria"
                    >
                      <Archive className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            {active.filter((c) => c.kind === g.kind).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
            )}
          </div>
        </div>
      ))}

      {archived.length > 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6">
          <h2 className="mb-1 text-base font-bold tracking-tight">Categorias arquivadas</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Continuam nos relatórios e nos lançamentos antigos, mas não são oferecidas em
            lançamentos novos, recorrências ou importação por IA. Reative quando quiser voltar a
            usá-las.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {archived.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-xl border border-border p-4 opacity-70 grayscale transition-all hover:opacity-100 hover:grayscale-0"
              >
                <span className="flex items-center gap-3">
                  <IconBadge name={c.emoji} color={c.color} />
                  <span>
                    <span className="block text-sm font-semibold">{c.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Arquivada em {formatDateBR(c.archived_at!.slice(0, 10))}
                    </span>
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Arquivada continua editável: corrigir o nome de uma categoria
                      antiga conserta também o que ela mostra nos relatórios. */}
                  <button
                    onClick={() => edit(c)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
                    aria-label={`Editar ${c.name}`}
                    title="Editar categoria"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={async () => {
                      await upsert.mutateAsync({ id: c.id, archived_at: null });
                      toast.success(`Categoria “${c.name}” reativada`);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-positive-soft hover:text-positive-soft-foreground"
                    aria-label={`Reativar ${c.name}`}
                  >
                    <RotateCcw className="size-3.5" /> Reativar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={archiving !== null}
        onOpenChange={(value) => !value && setArchiving(null)}
        itemLabel="categoria"
        itemName={archiving?.name ?? ""}
        title="Arquivar categoria"
        confirmLabel="Arquivar categoria"
        description={
          <>
            A categoria <span className="font-semibold text-foreground">{archiving?.name}</span>{" "}
            deixa de ser oferecida em lançamentos novos. Nada do histórico é apagado.
          </>
        }
        consequences={[
          "Continua aparecendo nos relatórios e nos lançamentos já registrados",
          "Some das listas de nova transação, de recorrência e da importação por IA",
          "Pode ser reativada a qualquer momento nesta mesma tela",
        ]}
        onConfirm={async () => {
          const category = archiving!;
          await upsert.mutateAsync({ id: category.id, archived_at: new Date().toISOString() });
          toast.success(`Categoria “${category.name}” arquivada`);
          setArchiving(null);
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar categoria" : "Nova categoria"}</DialogTitle>
          </DialogHeader>
          {editingArchived && (
            <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs text-warning-soft-foreground">
              Esta categoria está arquivada. As alterações valem também para os lançamentos antigos,
              que continuam ligados a ela; para voltar a usá-la em lançamentos novos, reative-a na
              lista.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="categoria-nome">Nome</Label>
              <Input
                id="categoria-nome"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="categoria-tipo">Tipo</Label>
              <select
                id="categoria-tipo"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as "income" | "expense" })}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
              >
                <option value="expense">Saída</option>
                <option value="income">Entrada</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Ícone</Label>
              <IconPicker
                value={form.emoji}
                color={form.color}
                onChange={(icon) => setForm({ ...form, emoji: icon })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="categoria-cor">Cor</Label>
              <Input
                id="categoria-cor"
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-11 cursor-pointer p-1"
              />
            </div>
            {form.kind === "expense" && (
              <div className="space-y-1.5">
                <Label htmlFor="categoria-teto">Teto mensal (R$)</Label>
                <Input
                  id="categoria-teto"
                  inputMode="decimal"
                  value={form.monthly_cap}
                  onChange={(e) => setForm({ ...form, monthly_cap: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="categoria-palavras">Palavras-chave da fatura</Label>
              <textarea
                id="categoria-palavras"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex.: IFOOD, RESTAURANTE, PADARIA, MERCADO"
                className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25"
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
