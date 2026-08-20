import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { useCategories, useUpsert } from "@/lib/data";
import { parseStatement, type ParsedRow } from "@/lib/ai-import.functions";
import { brl } from "@/lib/format";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

type Draft = ParsedRow & { category_id: string; include: boolean };

export function AiImportDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: categories = [] } = useCategories(profileId);
  const upsert = useUpsert("transactions");
  const parse = useServerFn(parseStatement);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Draft[]>([]);

  async function analyse() {
    setLoading(true);
    try {
      const res = await parse({
        data: { text, categories: categories.map((c) => c.name) },
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (!res.rows.length) {
        toast.error("Nenhum lançamento identificado no texto");
        return;
      }
      setRows(
        res.rows.map((r) => ({
          ...r,
          include: true,
          category_id:
            categories.find(
              (c) => c.kind === r.kind && c.name.toLowerCase() === r.category.toLowerCase(),
            )?.id ?? "",
        })),
      );
      toast.success(`${res.rows.length} lançamentos identificados`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar");
    } finally {
      setLoading(false);
    }
  }

  function patch(i: number, values: Partial<Draft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...values } : r)));
  }

  async function commit() {
    const selected = rows.filter((r) => r.include);
    if (!selected.length) {
      toast.error("Selecione ao menos um lançamento");
      return;
    }
    await upsert.mutateAsync(
      selected.map((r) => ({
        profile_id: profileId,
        description: r.description,
        amount: r.amount,
        kind: r.kind,
        transaction_date: r.date,
        due_date: r.due_date || r.date,
        status: "pending",
        category_id: r.category_id || null,
        installment_no: r.installment_no,
        installment_total: r.installment_total,
      })),
    );
    toast.success(`${selected.length} lançamentos importados`);
    setRows([]);
    setText("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Importar fatura ou extrato com IA
          </DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="space-y-3">
            <Label>Cole o texto da fatura ou extrato</Label>
            <Textarea
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"01/03  UBER TRIP           R$ 24,90\n02/03  MERCADO XPTO 2/5     R$ 189,00"}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              A IA categoriza cada linha e devolve uma lista para você conferir e ajustar antes de
              lançar em massa.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-12 items-center gap-2 rounded-xl border border-border p-2"
              >
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => patch(i, { include: e.target.checked })}
                  className="col-span-1 size-4 accent-[var(--color-primary)]"
                  aria-label="Incluir lançamento"
                />
                <Input
                  className="col-span-4 h-8 text-xs"
                  value={r.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                />
                <Input
                  type="date"
                  className="col-span-2 h-8 text-xs"
                  value={r.date}
                  onChange={(e) => patch(i, { date: e.target.value, due_date: e.target.value })}
                />
                <select
                  className="col-span-3 h-8 rounded-md border border-input bg-card px-2 text-xs"
                  value={r.category_id}
                  onChange={(e) => patch(i, { category_id: e.target.value })}
                >
                  <option value="">Sem categoria</option>
                  {categories
                    .filter((c) => c.kind === r.kind)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                </select>
                <span
                  className={`col-span-2 text-right font-mono text-xs font-semibold ${
                    r.kind === "income" ? "text-positive" : "text-negative"
                  }`}
                >
                  {r.kind === "income" ? "+" : "−"}
                  {brl(r.amount)}
                </span>
              </div>
            ))}
            <button
              onClick={() => setRows([])}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" /> Descartar análise
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {rows.length === 0 ? (
            <Button onClick={analyse} disabled={loading || text.trim().length < 10}>
              {loading ? "Analisando…" : "Analisar com IA"}
            </Button>
          ) : (
            <Button onClick={commit} disabled={upsert.isPending}>
              Lançar selecionados
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
